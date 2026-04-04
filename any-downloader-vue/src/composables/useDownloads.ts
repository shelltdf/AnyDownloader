import { computed, reactive, ref } from 'vue'
import { type DetectedProtocol, type ProtocolDetectResult } from '../utils/protocol'
import type { SavePickResult } from '../utils/savePicker'
import { idbDeletePartial, idbLoadPartial, idbSavePartial, type PersistedHttpTask } from '../utils/downloadIdb'
import { useLog } from './useLog'

export type TaskStatus = 'queued' | 'running' | 'paused' | 'done' | 'error'

export type ChunkSlotState = 'pending' | 'active' | 'done'

const CHUNK_SLOTS = 32
const NUM_PARTS = 6
const SPEED_HISTORY_MAX = 80
const SPEED_SAMPLE_MS = 280

export interface PartState {
  start: number
  end: number
  filled: number
  buffer: Uint8Array
}

export interface DownloadTask {
  id: string
  displayUrl: string
  href: string
  protocol: DetectedProtocol
  status: TaskStatus
  progress: number
  bytesReceived: number
  totalBytes: number | null
  speedBps: number
  speedHistory: number[]
  errorMessage: string | null
  fileName: string
  saveFileName: string
  saveHandle: FileSystemFileHandle | null
  chunkSlots: ChunkSlotState[]
  abort: AbortController | null
  _parts: PartState[] | null
  _speedTimer: ReturnType<typeof setInterval> | null
  _multipart: boolean
}

let idSeq = 1
function nextId() {
  return `t-${idSeq++}`
}

function emptyChunkSlots(): ChunkSlotState[] {
  return Array.from({ length: CHUNK_SLOTS }, () => 'pending')
}

const { log } = useLog()

const tasks = reactive<DownloadTask[]>([])
const selectedId = ref<string | null>(null)

const selectedTask = computed(() => tasks.find((t) => t.id === selectedId.value) ?? null)

function guessFileName(url: string, res: Response): string {
  const cd = res.headers.get('content-disposition')
  if (cd) {
    const m = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(cd)
    if (m) {
      try {
        return decodeURIComponent(m[1].trim())
      } catch {
        return m[1].trim()
      }
    }
  }
  try {
    const u = new URL(url)
    const seg = u.pathname.split('/').filter(Boolean).pop()
    if (seg) return decodeURIComponent(seg)
  } catch {
    /* ignore */
  }
  return 'download'
}

async function writeFinalBlob(handle: FileSystemFileHandle | null, blob: Blob, fallbackName: string) {
  if (handle && 'createWritable' in handle) {
    const w = await handle.createWritable()
    await w.write(blob)
    await w.close()
    return
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = fallbackName
  a.click()
  URL.revokeObjectURL(a.href)
}

function sumFilled(parts: PartState[]): number {
  return parts.reduce((s, p) => s + p.filled, 0)
}

function coverageInSlot(parts: PartState[] | null, total: number, slotIndex: number): { done: boolean; active: boolean } {
  const lo = (slotIndex / CHUNK_SLOTS) * total
  const hi = ((slotIndex + 1) / CHUNK_SLOTS) * total
  if (!parts || parts.length === 0) {
    return { done: false, active: false }
  }
  let covered = 0
  let anyActive = false
  for (const p of parts) {
    const ps = p.start
    const pe = p.end + 1
    const a = Math.max(lo, ps)
    const b = Math.min(hi, pe)
    if (b > a) {
      const segStart = a - ps
      const segEnd = b - ps
      const got = Math.max(0, Math.min(p.filled, segEnd) - Math.max(0, segStart))
      covered += got
      if (p.filled < p.buffer.length && b > ps + p.filled && b > lo && a < hi) anyActive = true
    }
  }
  const span = hi - lo
  const done = span > 0 && covered >= span - 0.5
  return { done, active: anyActive && !done }
}

function refreshChunkSlotsSingleStream(task: DownloadTask) {
  if (!task.totalBytes || task.totalBytes <= 0) {
    for (let i = 0; i < CHUNK_SLOTS; i++) {
      const thr = (i + 1) / CHUNK_SLOTS
      if (task.progress >= thr) task.chunkSlots[i] = 'done'
      else if (task.status === 'running' && task.progress > i / CHUNK_SLOTS) task.chunkSlots[i] = 'active'
      else task.chunkSlots[i] = 'pending'
    }
    return
  }
  const total = task.totalBytes
  for (let i = 0; i < CHUNK_SLOTS; i++) {
    const lo = (i / CHUNK_SLOTS) * total
    const hi = ((i + 1) / CHUNK_SLOTS) * total
    if (task.bytesReceived >= hi - 0.5) task.chunkSlots[i] = 'done'
    else if (task.bytesReceived > lo && task.status === 'running') task.chunkSlots[i] = 'active'
    else task.chunkSlots[i] = 'pending'
  }
}

function refreshChunkSlots(task: DownloadTask) {
  if (!task.totalBytes || task.totalBytes <= 0) {
    for (let i = 0; i < CHUNK_SLOTS; i++) {
      task.chunkSlots[i] = task.status === 'running' ? 'active' : 'pending'
    }
    return
  }
  const total = task.totalBytes
  if (!task._parts) {
    refreshChunkSlotsSingleStream(task)
    return
  }
  for (let i = 0; i < CHUNK_SLOTS; i++) {
    const { done, active } = coverageInSlot(task._parts, total, i)
    if (done) task.chunkSlots[i] = 'done'
    else if (active) task.chunkSlots[i] = 'active'
    else task.chunkSlots[i] = 'pending'
  }
}

function startSpeedSampler(task: DownloadTask) {
  stopSpeedSampler(task)
  task._speedTimer = setInterval(() => {
    if (task.status !== 'running') return
    const v = task.speedBps
    task.speedHistory.push(v)
    if (task.speedHistory.length > SPEED_HISTORY_MAX) task.speedHistory.splice(0, task.speedHistory.length - SPEED_HISTORY_MAX)
  }, SPEED_SAMPLE_MS)
}

function stopSpeedSampler(task: DownloadTask) {
  if (task._speedTimer != null) {
    clearInterval(task._speedTimer)
    task._speedTimer = null
  }
}

async function probeMeta(
  href: string,
  signal: AbortSignal,
): Promise<{ length: number | null; acceptRanges: boolean }> {
  try {
    const h = await fetch(href, { method: 'HEAD', signal, mode: 'cors', cache: 'no-store' })
    if (h.ok) {
      const cl = h.headers.get('content-length')
      const ar = (h.headers.get('accept-ranges') || '').toLowerCase().includes('bytes')
      const len = cl ? Number(cl) : null
      return { length: Number.isFinite(len as number) ? len : null, acceptRanges: ar }
    }
  } catch {
    /* try range probe */
  }
  try {
    const r = await fetch(href, { headers: { Range: 'bytes=0-0' }, signal, mode: 'cors', cache: 'no-store' })
    if (r.status === 206) {
      const cr = r.headers.get('content-range')
      const m = /\/(\d+)\s*$/.exec(cr || '')
      const len = m ? Number(m[1]) : null
      await r.body?.cancel()
      return { length: Number.isFinite(len as number) ? len : null, acceptRanges: true }
    }
  } catch {
    /* ignore */
  }
  return { length: null, acceptRanges: false }
}

function buildParts(total: number, count: number): PartState[] {
  const parts: PartState[] = []
  const base = Math.floor(total / count)
  let at = 0
  for (let i = 0; i < count; i++) {
    const end = i === count - 1 ? total - 1 : at + base - 1
    const len = end - at + 1
    parts.push({ start: at, end, filled: 0, buffer: new Uint8Array(len) })
    at = end + 1
  }
  return parts
}

function mergePersistedParts(parts: PartState[], persisted: PersistedHttpTask): void {
  for (let i = 0; i < Math.min(parts.length, persisted.parts.length); i++) {
    const p = persisted.parts[i]
    const st = parts[i]
    if (p.start !== st.start || p.end !== st.end) continue
    const u8 = new Uint8Array(p.data)
    const n = Math.min(u8.length, st.buffer.length, p.filled)
    st.buffer.set(u8.subarray(0, n), 0)
    st.filled = Math.min(p.filled, st.buffer.length)
  }
}

async function persistParts(task: DownloadTask) {
  if (!task._parts || !task.totalBytes) return
  const row: PersistedHttpTask = {
    id: task.id,
    href: task.href,
    totalBytes: task.totalBytes,
    partCount: task._parts.length,
    parts: task._parts.map((p) => {
      const u = new Uint8Array(p.buffer.length)
      u.set(p.buffer)
      return {
        start: p.start,
        end: p.end,
        filled: p.filled,
        data: u.buffer,
      }
    }),
    updatedAt: Date.now(),
  }
  await idbSavePartial(row)
}

async function fetchPart(task: DownloadTask, index: number, signal: AbortSignal) {
  const p = task._parts![index]
  if (p.filled >= p.buffer.length) return
  const start = p.start + p.filled
  const end = p.end
  const headers: Record<string, string> = {}
  if (task._multipart) headers.Range = `bytes=${start}-${end}`

  const res = await fetch(task.href, { headers, signal, mode: 'cors', cache: 'no-store' })
  if (task._multipart && res.status === 200) {
    await res.body?.cancel()
    throw Object.assign(new Error('NO_RANGE'), { code: 'NO_RANGE' as const })
  }
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`)

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No body')

  let lastT = performance.now()
  let lastFilled = sumFilled(task._parts!)

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    const room = p.buffer.length - p.filled
    const take = Math.min(room, value.length)
    if (take > 0) {
      p.buffer.set(value.subarray(0, take), p.filled)
      p.filled += take
    }
    task.bytesReceived = sumFilled(task._parts!)
    const now = performance.now()
    const dt = (now - lastT) / 1000
    if (dt >= 0.2) {
      task.speedBps = (task.bytesReceived - lastFilled) / dt
      lastT = now
      lastFilled = task.bytesReceived
    }
    if (task.totalBytes && task.totalBytes > 0) {
      task.progress = Math.min(1, task.bytesReceived / task.totalBytes)
    }
    refreshChunkSlots(task)
  }
}

async function runHttpMultipart(task: DownloadTask, corsMsg: string) {
  const ac = new AbortController()
  task.abort = ac
  task.status = 'running'
  task.errorMessage = null
  task.speedBps = 0
  startSpeedSampler(task)

  try {
    const meta = await probeMeta(task.href, ac.signal)
    let total = meta.length
    let canRange = meta.acceptRanges && total != null && total > 0

    if (canRange && total) {
      const probe = await fetch(task.href, {
        headers: { Range: 'bytes=0-0' },
        signal: ac.signal,
        mode: 'cors',
        cache: 'no-store',
      })
      if (probe.status !== 206) {
        canRange = false
        await probe.body?.cancel()
      } else {
        await probe.body?.cancel()
      }
    }

    if (!canRange || !total) {
      await runHttpSingleStream(task, ac)
      return
    }

    task.totalBytes = total
    task._multipart = true
    let parts = buildParts(total, NUM_PARTS)

    const persisted = await idbLoadPartial(task.id)
    if (persisted && persisted.href === task.href && persisted.totalBytes === total) {
      mergePersistedParts(parts, persisted)
    }

    task._parts = parts
    task.bytesReceived = sumFilled(parts)
    task.progress = total > 0 ? task.bytesReceived / total : 0
    refreshChunkSlots(task)

    try {
      await Promise.all(parts.map((_, i) => fetchPart(task, i, ac.signal)))
    } catch (e) {
      if ((e as { code?: string }).code === 'NO_RANGE' && !ac.signal.aborted) {
        task._parts = null
        task.bytesReceived = 0
        task.progress = 0
        task.totalBytes = null
        await runHttpSingleStream(task, ac)
        return
      }
      throw e
    }

    task.bytesReceived = sumFilled(parts)
    task.progress = 1
    for (let i = 0; i < CHUNK_SLOTS; i++) task.chunkSlots[i] = 'done'

    const merged = new Uint8Array(total)
    let off = 0
    for (const p of parts) {
      merged.set(p.buffer.subarray(0, p.buffer.length), off)
      off += p.buffer.length
    }
    const blob = new Blob([merged])
    task.fileName = task.saveFileName
    await writeFinalBlob(task.saveHandle, blob, task.saveFileName)
    task.status = 'done'
    await idbDeletePartial(task.id)
    log('info', `完成: ${task.saveFileName} (${task.bytesReceived} B)`)
  } catch (e) {
    const err = e as Error
    if (err.name === 'AbortError') {
      task.status = 'paused'
      task.errorMessage = null
      if (task._parts && task.totalBytes) await persistParts(task)
      log('info', `已暂停: ${task.displayUrl}`)
    } else {
      task.status = 'error'
      const isNet =
        /failed to fetch|load failed|networkerror|aborted/i.test(err.message) || err.name === 'TypeError'
      task.errorMessage = isNet ? corsMsg : err.message
      log('error', `${task.displayUrl}: ${err.message}`)
    }
  } finally {
    stopSpeedSampler(task)
    task.abort = null
    task._parts = null
    task._multipart = false
  }
}

async function runHttpSingleStream(task: DownloadTask, ac: AbortController) {
  task._multipart = false
  task._parts = null
  const res = await fetch(task.href, { signal: ac.signal, mode: 'cors', cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const cl = res.headers.get('content-length')
  task.totalBytes = cl ? Number(cl) : null
  const fn = guessFileName(task.href, res)
  if (!task.saveFileName.includes('.')) task.fileName = fn

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No body')

  const chunks: Uint8Array[] = []
  let lastT = performance.now()
  let lastBytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      task.bytesReceived += value.length
      const now = performance.now()
      const dt = (now - lastT) / 1000
      if (dt >= 0.2) {
        task.speedBps = (task.bytesReceived - lastBytes) / dt
        lastT = now
        lastBytes = task.bytesReceived
      }
      if (task.totalBytes && task.totalBytes > 0) {
        task.progress = Math.min(1, task.bytesReceived / task.totalBytes)
      } else {
        task.progress = task.bytesReceived > 0 ? 0.08 : 0
      }
      refreshChunkSlotsSingleStream(task)
    }
  }

  task.progress = 1
  for (let i = 0; i < CHUNK_SLOTS; i++) task.chunkSlots[i] = 'done'

  const blob = new Blob(chunks as BlobPart[])
  await writeFinalBlob(task.saveHandle, blob, task.saveFileName)
  task.status = 'done'
  await idbDeletePartial(task.id)
  log('info', `完成: ${task.saveFileName} (${task.bytesReceived} B)`)
}

async function runHttpTask(task: DownloadTask, corsMsg: string) {
  await runHttpMultipart(task, corsMsg)
}

async function runDataTask(task: DownloadTask) {
  task.status = 'running'
  task.errorMessage = null
  startSpeedSampler(task)
  try {
    const res = await fetch(task.href)
    const blob = await res.blob()
    task.bytesReceived = blob.size
    task.totalBytes = blob.size
    task.progress = 1
    for (let i = 0; i < CHUNK_SLOTS; i++) task.chunkSlots[i] = 'done'
    task.speedBps = 0
    task.speedHistory.push(0)
    await writeFinalBlob(task.saveHandle, blob, task.saveFileName)
    task.status = 'done'
    log('info', `完成: ${task.saveFileName} (${blob.size} B)`)
  } catch (e) {
    task.status = 'error'
    task.errorMessage = (e as Error).message
    log('error', `data: ${task.errorMessage}`)
  } finally {
    stopSpeedSampler(task)
  }
}

function placeholderFail(task: DownloadTask, i18nKey: string) {
  task.status = 'error'
  task.errorMessage = i18nKey
  log('warn', `${task.protocol}: ${task.href}`)
}

function makeTask(det: ProtocolDetectResult, save: SavePickResult): DownloadTask {
  return {
    id: nextId(),
    displayUrl: det.displayUrl,
    href: det.href,
    protocol: det.protocol,
    status: 'queued',
    progress: 0,
    bytesReceived: 0,
    totalBytes: null,
    speedBps: 0,
    speedHistory: [],
    errorMessage: null,
    fileName: save.fileName,
    saveFileName: save.fileName,
    saveHandle: save.handle,
    chunkSlots: emptyChunkSlots(),
    abort: null,
    _parts: null,
    _speedTimer: null,
    _multipart: false,
  }
}

export function useDownloads() {
  function enqueueTask(det: ProtocolDetectResult, save: SavePickResult): void {
    const task = makeTask(det, save)
    tasks.push(task)
    selectedId.value = task.id
    log('info', `已添加 [${det.protocol}] → ${save.fileName}`)
  }

  function selectTask(id: string | null) {
    selectedId.value = id
  }

  function removeTask(id: string | null) {
    if (!id) return
    const i = tasks.findIndex((t) => t.id === id)
    if (i < 0) return
    const t = tasks[i]
    t.abort?.abort()
    void idbDeletePartial(t.id)
    tasks.splice(i, 1)
    if (selectedId.value === id) selectedId.value = tasks[0]?.id ?? null
  }

  function removeSelected() {
    removeTask(selectedId.value)
  }

  async function runTask(task: DownloadTask, errNeedBackend: string, corsMsg: string) {
    if (task.status === 'running') return
    if (task.protocol === 'http' || task.protocol === 'https' || task.protocol === 'blob') {
      await runHttpTask(task, corsMsg)
      return
    }
    if (task.protocol === 'data') {
      await runDataTask(task)
      return
    }
    placeholderFail(task, errNeedBackend)
  }

  async function startTask(id: string | null, errNeedBackend: string, corsMsg: string) {
    const task = id ? tasks.find((t) => t.id === id) : null
    if (!task || task.status === 'running' || task.status === 'done') return
    if (task.status === 'error') {
      task.errorMessage = null
      task.progress = 0
      task.bytesReceived = 0
      task.speedHistory.length = 0
      for (let i = 0; i < CHUNK_SLOTS; i++) task.chunkSlots[i] = 'pending'
      void idbDeletePartial(task.id)
    }
    await runTask(task, errNeedBackend, corsMsg)
  }

  async function startSelected(errNeedBackend: string, corsMsg: string) {
    await startTask(selectedId.value, errNeedBackend, corsMsg)
  }

  function pauseTask(id: string | null) {
    const task = id ? tasks.find((t) => t.id === id) : null
    if (!task || task.status !== 'running') return
    task.abort?.abort()
  }

  function pauseSelected() {
    pauseTask(selectedId.value)
  }

  return {
    tasks,
    selectedId,
    selectedTask,
    enqueueTask,
    selectTask,
    removeTask,
    removeSelected,
    startTask,
    startSelected,
    pauseTask,
    pauseSelected,
  }
}
