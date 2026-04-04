import { computed, reactive, ref, watch } from 'vue'
import { type DetectedProtocol, type ProtocolDetectResult } from '../utils/protocol'
import type { SavePickResult } from '../utils/savePicker'
import { idbDeletePartial, idbLoadPartial, idbSavePartial, type PersistedHttpTask } from '../utils/downloadIdb'
import { useDownloadThreads } from './useDownloadThreads'
import {
  effectiveMaxConcurrentTasks,
  pressureConnectionMultiplier,
  taskConcurrencyMode,
  maxConcurrentTasksManual,
  pressureStrategy,
} from './useDownloadPolicy'
import { useLog } from './useLog'

/** 选中任务与服务器 HTTP 交互摘要（按任务 id） */
export const taskCommLogs = reactive<Record<string, string[]>>({})
const COMM_LOG_MAX = 400

function appendTaskCommLog(taskId: string, line: string) {
  if (!taskCommLogs[taskId]) taskCommLogs[taskId] = []
  const arr = taskCommLogs[taskId]
  const ts = new Date().toLocaleTimeString()
  arr.push(`[${ts}] ${line}`)
  if (arr.length > COMM_LOG_MAX) arr.splice(0, arr.length - COMM_LOG_MAX)
}

function clearTaskCommLog(taskId: string) {
  delete taskCommLogs[taskId]
}

function formatLoggedHeaders(res: Response): string {
  const keys = ['content-type', 'content-length', 'accept-ranges', 'content-range', 'content-disposition']
  return keys
    .map((k) => {
      const v = res.headers.get(k)
      return v ? `${k}=${v}` : ''
    })
    .filter(Boolean)
    .join('; ')
}

function rangeHint(init?: RequestInit): string {
  if (!init?.headers) return ''
  const h = init.headers
  if (h instanceof Headers) {
    const r = h.get('Range')
    return r ? ` Range:${r}` : ''
  }
  if (Array.isArray(h)) {
    const row = h.find(([k]) => k.toLowerCase() === 'range')
    return row ? ` Range:${row[1]}` : ''
  }
  const o = h as Record<string, string>
  const r = o.Range ?? o.range
  return r ? ` Range:${r}` : ''
}

async function loggedFetch(taskId: string, label: string, input: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase()
  appendTaskCommLog(taskId, `→ ${method} ${label}${rangeHint(init)}`)
  const t0 = performance.now()
  try {
    const res = await fetch(input, init)
    const ms = Math.round(performance.now() - t0)
    const head = formatLoggedHeaders(res)
    appendTaskCommLog(taskId, `← ${res.status} ${ms}ms${head ? ` ${head}` : ''}`)
    return res
  } catch (e) {
    const err = e as Error
    appendTaskCommLog(taskId, `✗ ${err.name}: ${err.message}`)
    throw e
  }
}

export type TaskStatus = 'queued' | 'running' | 'paused' | 'done' | 'error'

export type ChunkSlotState = 'pending' | 'active' | 'done' | 'paused'

/** 任务最终走单连接时向用户展示的原因（多连接探测或并行拉取失败） */
export type SingleConnReason = 'none' | 'unknown_size' | 'range_not_accepted' | 'parallel_no_range'

const CHUNK_SLOTS = 32
const SPEED_HISTORY_MAX = 80
const SPEED_SAMPLE_MS = 280

const { effectiveThreadCount } = useDownloadThreads()

/** 供界面展示：当前连接形态与瓶颈提示 */
export const sessionDownloadInfo = reactive({
  connectionKind: 'none' as 'none' | 'parallel' | 'single',
  activeThreads: null as number | null,
  bottleneck: 'none' as 'none' | 'no_range' | 'unknown_size',
})

/** 本应用侧观察到的磁盘写入吞吐（浏览器无法读取系统级磁盘曲线，仅统计写文件/IndexedDB 耗时） */
export const sessionIoStats = reactive({
  writeBps: 0,
})

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
  /** null = 使用全局自动/手动连接数设置 */
  threadOverride: number | null
  /** 本次任务开始下载的时间戳（ms），暂停续传不重置 */
  runStartedAt: number | null
  /** 当前 HTTP 并行连接数；非 running 时为 0 */
  activeConnections: number
  /** 网络数据已收齐，正在写入磁盘 / 触发保存 */
  isWriting: boolean
  /** 每格 0–1，传输中格表示该格内字节完成比例（供饼图） */
  chunkFill: number[]
  /** 本任务为何使用单连接（并行成功时为 none） */
  singleConnReason: SingleConnReason
}

let idSeq = 1
function nextId() {
  return `t-${idSeq++}`
}

function emptyChunkSlots(): ChunkSlotState[] {
  return Array.from({ length: CHUNK_SLOTS }, () => 'pending')
}

function emptyChunkFill(): number[] {
  return Array.from({ length: CHUNK_SLOTS }, () => 0)
}

function recordDiskWrite(bytes: number, ms: number) {
  const t = Math.max(ms, 1)
  sessionIoStats.writeBps = (bytes * 1000) / t
}

const { log } = useLog()

const tasks = reactive<DownloadTask[]>([])
const selectedId = ref<string | null>(null)

const selectedTask = computed(() => tasks.find((t) => t.id === selectedId.value) ?? null)

/** Content-Length 与实际体不一致时，已收字节可能略大于宣告总长 */
function capBytesToTotal(task: DownloadTask) {
  if (task.totalBytes != null && task.totalBytes > 0) {
    task.bytesReceived = Math.min(task.bytesReceived, task.totalBytes)
  }
}

/** 界面展示用：不超过总长（不修改任务状态） */
export function bytesReceivedForDisplay(task: DownloadTask): number {
  if (task.totalBytes != null && task.totalBytes > 0) {
    return Math.min(task.bytesReceived, task.totalBytes)
  }
  return task.bytesReceived
}

function clampProgress(task: DownloadTask) {
  capBytesToTotal(task)
  if (task.totalBytes && task.totalBytes > 0) {
    const raw = task.bytesReceived / task.totalBytes
    if (task.status === 'done') task.progress = Math.min(1, Math.max(0, raw))
    else task.progress = Math.min(0.99, Math.max(0, raw))
  }
}

function effPartCount(total: number | null, override: number | null): number {
  const base = effectiveThreadCount(total, override)
  const m = pressureConnectionMultiplier()
  return Math.max(1, Math.min(16, Math.round(base * m)))
}

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
  const t0 = performance.now()
  if (handle && 'createWritable' in handle) {
    const w = await handle.createWritable()
    await w.write(blob)
    await w.close()
    recordDiskWrite(blob.size, performance.now() - t0)
    return
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = fallbackName
  a.click()
  URL.revokeObjectURL(a.href)
  recordDiskWrite(blob.size, performance.now() - t0)
}

function sumFilled(parts: PartState[]): number {
  return parts.reduce((s, p) => s + p.filled, 0)
}

/** 某显示格内已下载比例及是否仍在传 */
function slotCoverage(parts: PartState[] | null, total: number, slotIndex: number): { done: boolean; active: boolean; ratio: number } {
  const lo = (slotIndex / CHUNK_SLOTS) * total
  const hi = ((slotIndex + 1) / CHUNK_SLOTS) * total
  const span = hi - lo
  if (!parts || parts.length === 0) {
    return { done: false, active: false, ratio: 0 }
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
  const done = span > 0 && covered >= span - 1e-6
  const ratio = span > 0 ? Math.min(1, Math.max(0, covered / span)) : 0
  return { done, active: anyActive && !done, ratio }
}

/** 无分片内存视图时（暂停后 _parts 已清空），仅用 bytesReceived 刷新块图与进度 */
function refreshChunkSlotsFromBytes(task: DownloadTask) {
  const showPartial = task.status === 'running' || task.status === 'paused'
  if (!task.totalBytes || task.totalBytes <= 0) {
    for (let i = 0; i < CHUNK_SLOTS; i++) {
      const thr = (i + 1) / CHUNK_SLOTS
      if (task.progress >= thr) {
        task.chunkSlots[i] = 'done'
        task.chunkFill[i] = 1
      } else if (showPartial && task.bytesReceived > (i / CHUNK_SLOTS) * (task.totalBytes || 1)) {
        task.chunkSlots[i] = task.status === 'paused' ? 'paused' : 'active'
        task.chunkFill[i] = 0.2
      } else {
        task.chunkSlots[i] = 'pending'
        task.chunkFill[i] = 0
      }
    }
    return
  }
  const total = task.totalBytes
  const br = Math.min(task.bytesReceived, total)
  for (let i = 0; i < CHUNK_SLOTS; i++) {
    const lo = (i / CHUNK_SLOTS) * total
    const hi = ((i + 1) / CHUNK_SLOTS) * total
    const span = hi - lo
    if (br >= hi - 1e-6) {
      task.chunkSlots[i] = 'done'
      task.chunkFill[i] = 1
    } else if (br > lo && showPartial) {
      task.chunkSlots[i] = task.status === 'paused' ? 'paused' : 'active'
      task.chunkFill[i] = span > 0 ? Math.min(1, Math.max(0, (br - lo) / span)) : 0
    } else {
      task.chunkSlots[i] = 'pending'
      task.chunkFill[i] = 0
    }
  }
}

function refreshChunkSlots(task: DownloadTask) {
  if (!task.totalBytes || task.totalBytes <= 0) {
    const cand = task.status === 'running' || task.status === 'paused'
    for (let i = 0; i < CHUNK_SLOTS; i++) {
      task.chunkSlots[i] = cand ? (task.status === 'paused' ? 'paused' : 'active') : 'pending'
      task.chunkFill[i] = cand ? 0.15 : 0
    }
    return
  }
  if (!task._parts) {
    refreshChunkSlotsFromBytes(task)
    return
  }
  const total = task.totalBytes
  const isPaused = task.status === 'paused'
  for (let i = 0; i < CHUNK_SLOTS; i++) {
    const { done, active, ratio } = slotCoverage(task._parts, total, i)
    if (done) {
      task.chunkSlots[i] = 'done'
      task.chunkFill[i] = 1
    } else if (active || (isPaused && ratio > 0)) {
      task.chunkSlots[i] = isPaused ? 'paused' : 'active'
      task.chunkFill[i] = ratio
    } else {
      task.chunkSlots[i] = 'pending'
      task.chunkFill[i] = 0
    }
  }
}

function startSpeedSampler(task: DownloadTask) {
  stopSpeedSampler(task)
  task.speedHistory.length = 0
  task._speedTimer = setInterval(() => {
    if (task.status !== 'running') return
    if (task.isWriting) return
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
  taskId: string,
): Promise<{ length: number | null; acceptRanges: boolean }> {
  try {
    const h = await loggedFetch(taskId, 'HEAD', href, { method: 'HEAD', signal, mode: 'cors', cache: 'no-store' })
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
    const r = await loggedFetch(taskId, 'Range probe', href, {
      headers: { Range: 'bytes=0-0' },
      signal,
      mode: 'cors',
      cache: 'no-store',
    })
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
  const n = Math.min(16, Math.max(1, Math.floor(count)))
  const base = Math.floor(total / n)
  let at = 0
  for (let i = 0; i < n; i++) {
    const end = i === n - 1 ? total - 1 : at + base - 1
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
    const n = Math.min(p.filled, st.buffer.length, p.data.byteLength)
    if (n <= 0) continue
    st.buffer.set(new Uint8Array(p.data, 0, n), 0)
    st.filled = n
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
      const filled = p.filled
      const copy = new Uint8Array(filled)
      if (filled > 0) copy.set(p.buffer.subarray(0, filled), 0)
      return {
        start: p.start,
        end: p.end,
        filled,
        data: copy.buffer,
      }
    }),
    updatedAt: Date.now(),
  }
  const t0 = performance.now()
  await idbSavePartial(row)
  const bytes = row.parts.reduce((s, p) => s + p.filled, 0)
  const dt = performance.now() - t0
  if (bytes > 0 && dt >= 0) recordDiskWrite(bytes, dt)
}

async function fetchPart(task: DownloadTask, index: number, signal: AbortSignal) {
  const p = task._parts![index]
  if (p.filled >= p.buffer.length) return
  const start = p.start + p.filled
  const end = p.end
  const headers: Record<string, string> = {}
  if (task._multipart) headers.Range = `bytes=${start}-${end}`

  const res = await loggedFetch(task.id, `GET part#${index + 1}`, task.href, {
    headers,
    signal,
    mode: 'cors',
    cache: 'no-store',
  })
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
    capBytesToTotal(task)
    clampProgress(task)
    const now = performance.now()
    const dt = (now - lastT) / 1000
    if (dt >= 0.2) {
      const instant = Math.max(0, (task.bytesReceived - lastFilled) / dt)
      const prev = task.speedBps
      task.speedBps = !Number.isFinite(prev) || prev <= 0 ? instant : prev * 0.55 + instant * 0.45
      lastT = now
      lastFilled = task.bytesReceived
    }
    refreshChunkSlots(task)
  }
}

async function runHttpMultipart(task: DownloadTask, corsMsg: string) {
  const othersRunning = tasks.filter((t) => t.id !== task.id && t.status === 'running').length
  if (othersRunning >= effectiveMaxConcurrentTasks()) {
    return
  }

  const ac = new AbortController()
  task.abort = ac
  task.status = 'running'
  task.errorMessage = null
  task.speedBps = 0
  task.isWriting = false
  task.activeConnections = 0
  task.singleConnReason = 'none'
  if (task.runStartedAt == null) task.runStartedAt = Date.now()
  startSpeedSampler(task)

  try {
    const meta = await probeMeta(task.href, ac.signal, task.id)
    let total = meta.length
    let canRange = meta.acceptRanges && total != null && total > 0

    if (canRange && total) {
      const probe = await loggedFetch(task.id, 'Range verify', task.href, {
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
      task.singleConnReason = !total ? 'unknown_size' : 'range_not_accepted'
      sessionDownloadInfo.connectionKind = 'single'
      sessionDownloadInfo.activeThreads = 1
      task.activeConnections = 1
      sessionDownloadInfo.bottleneck = !total ? 'unknown_size' : 'no_range'
      await runHttpSingleStream(task, ac)
      return
    }

    task.totalBytes = total
    task._multipart = true

    const persisted = await idbLoadPartial(task.id)
    let partCount = effPartCount(total, task.threadOverride)
    if (persisted && persisted.href === task.href && persisted.totalBytes === total) {
      partCount = persisted.partCount
    }

    let parts = buildParts(total, partCount)
    if (persisted && persisted.href === task.href && persisted.totalBytes === total && persisted.partCount === parts.length) {
      mergePersistedParts(parts, persisted)
    }

    task._parts = parts
    task.bytesReceived = sumFilled(parts)
    capBytesToTotal(task)
    clampProgress(task)
    refreshChunkSlots(task)

    sessionDownloadInfo.connectionKind = 'parallel'
    sessionDownloadInfo.activeThreads = parts.length
    task.activeConnections = parts.length
    sessionDownloadInfo.bottleneck = 'none'

    try {
      await Promise.all(parts.map((_, i) => fetchPart(task, i, ac.signal)))
    } catch (e) {
      if ((e as { code?: string }).code === 'NO_RANGE' && !ac.signal.aborted) {
        task.singleConnReason = 'parallel_no_range'
        task.speedHistory.length = 0
        task.speedBps = 0
        sessionDownloadInfo.bottleneck = 'no_range'
        sessionDownloadInfo.connectionKind = 'single'
        sessionDownloadInfo.activeThreads = 1
        task.activeConnections = 1
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
    capBytesToTotal(task)
    task.activeConnections = 0
    task.speedBps = 0
    clampProgress(task)
    if (total > 0) task.progress = Math.min(0.99, task.bytesReceived / total)
    for (let i = 0; i < CHUNK_SLOTS; i++) {
      task.chunkSlots[i] = 'done'
      task.chunkFill[i] = 1
    }

    const merged = new Uint8Array(total)
    let off = 0
    for (const p of parts) {
      merged.set(p.buffer.subarray(0, p.buffer.length), off)
      off += p.buffer.length
    }
    const blob = new Blob([merged])
    task.fileName = task.saveFileName
    task.isWriting = true
    await writeFinalBlob(task.saveHandle, blob, task.saveFileName)
    task.isWriting = false
    task.progress = 1
    task.status = 'done'
    sessionDownloadInfo.connectionKind = 'none'
    sessionDownloadInfo.activeThreads = null
    await idbDeletePartial(task.id)
    log('info', `完成: ${task.saveFileName} (${task.bytesReceived} B)`)
  } catch (e) {
    const err = e as Error
    if (err.name === 'AbortError') {
      task.status = 'paused'
      task.errorMessage = null
      if (task._parts && task.totalBytes) {
        task.bytesReceived = sumFilled(task._parts)
        capBytesToTotal(task)
        clampProgress(task)
        await persistParts(task)
      }
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
    if (task.status === 'paused') {
      capBytesToTotal(task)
      clampProgress(task)
      if (task._parts && task.totalBytes && task.totalBytes > 0) {
        refreshChunkSlots(task)
      } else if (task.totalBytes && task.totalBytes > 0) {
        refreshChunkSlotsFromBytes(task)
      }
    }
    task._parts = null
    task._multipart = false
    task.activeConnections = 0
    task.isWriting = false
    if (task.status !== 'running') {
      sessionDownloadInfo.connectionKind = 'none'
      sessionDownloadInfo.activeThreads = null
    }
  }
}

async function runHttpSingleStream(task: DownloadTask, ac: AbortController) {
  task._multipart = false
  task._parts = null
  task.activeConnections = 1
  if (task.runStartedAt == null) task.runStartedAt = Date.now()
  task.speedBps = 0
  const res = await loggedFetch(task.id, 'GET', task.href, { signal: ac.signal, mode: 'cors', cache: 'no-store' })
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
      capBytesToTotal(task)
      const now = performance.now()
      const dt = (now - lastT) / 1000
      if (dt >= 0.2) {
        const instant = Math.max(0, (task.bytesReceived - lastBytes) / dt)
        const prev = task.speedBps
        task.speedBps = !Number.isFinite(prev) || prev <= 0 ? instant : prev * 0.55 + instant * 0.45
        lastT = now
        lastBytes = task.bytesReceived
      }
      if (task.totalBytes && task.totalBytes > 0) {
        task.progress = Math.min(0.99, task.bytesReceived / task.totalBytes)
      } else {
        task.progress = task.bytesReceived > 0 ? 0.08 : 0
      }
      refreshChunkSlotsFromBytes(task)
    }
  }

  task.activeConnections = 0
  capBytesToTotal(task)
  if (task.totalBytes && task.totalBytes > 0) {
    task.progress = Math.min(0.99, task.bytesReceived / task.totalBytes)
  } else {
    task.progress = 0.99
  }
  for (let i = 0; i < CHUNK_SLOTS; i++) {
    task.chunkSlots[i] = 'done'
    task.chunkFill[i] = 1
  }

  const blob = new Blob(chunks as BlobPart[])
  task.isWriting = true
  try {
    await writeFinalBlob(task.saveHandle, blob, task.saveFileName)
    task.isWriting = false
    task.progress = 1
    task.status = 'done'
    await idbDeletePartial(task.id)
    log('info', `完成: ${task.saveFileName} (${task.bytesReceived} B)`)
  } catch (e) {
    task.isWriting = false
    throw e
  }
}

async function runHttpTask(task: DownloadTask, corsMsg: string) {
  await runHttpMultipart(task, corsMsg)
}

async function runDataTask(task: DownloadTask) {
  const othersRunning = tasks.filter((t) => t.id !== task.id && t.status === 'running').length
  if (othersRunning >= effectiveMaxConcurrentTasks()) {
    return
  }

  task.status = 'running'
  task.errorMessage = null
  task.isWriting = false
  task.activeConnections = 1
  if (task.runStartedAt == null) task.runStartedAt = Date.now()
  startSpeedSampler(task)
  try {
    const res = await loggedFetch(task.id, 'GET data:', task.href)
    const blob = await res.blob()
    task.bytesReceived = blob.size
    task.totalBytes = blob.size
    task.progress = 0.99
    for (let i = 0; i < CHUNK_SLOTS; i++) {
      task.chunkSlots[i] = 'done'
      task.chunkFill[i] = 1
    }
    task.speedBps = 0
    task.speedHistory.push(0)
    task.isWriting = true
    await writeFinalBlob(task.saveHandle, blob, task.saveFileName)
    task.isWriting = false
    task.progress = 1
    task.status = 'done'
    task.activeConnections = 0
    log('info', `完成: ${task.saveFileName} (${blob.size} B)`)
  } catch (e) {
    task.status = 'error'
    task.errorMessage = (e as Error).message
    task.activeConnections = 0
    task.isWriting = false
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
    chunkFill: emptyChunkFill(),
    abort: null,
    _parts: null,
    _speedTimer: null,
    _multipart: false,
    threadOverride: null,
    runStartedAt: null,
    activeConnections: 0,
    isWriting: false,
    singleConnReason: 'none',
  }
}

function resetTaskProgress(task: DownloadTask) {
  task.errorMessage = null
  task.progress = 0
  task.bytesReceived = 0
  task.totalBytes = null
  task.speedBps = 0
  task.speedHistory.length = 0
  for (let i = 0; i < CHUNK_SLOTS; i++) {
    task.chunkSlots[i] = 'pending'
    task.chunkFill[i] = 0
  }
  task._parts = null
  task._multipart = false
  task.runStartedAt = null
  task.activeConnections = 0
  task.isWriting = false
  task.singleConnReason = 'none'
  void idbDeletePartial(task.id)
}

export function useDownloads() {
  function enqueueTask(det: ProtocolDetectResult, save: SavePickResult): void {
    const task = makeTask(det, save)
    tasks.push(task)
    selectedId.value = task.id
    log('info', `已添加 [${det.protocol}] → ${save.fileName}`)
  }

  function setTaskThreadOverride(id: string, count: number | null) {
    const t = tasks.find((x) => x.id === id)
    if (!t) return
    t.threadOverride = count != null && Number.isFinite(count) ? Math.min(16, Math.max(1, Math.floor(count))) : null
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
    clearTaskCommLog(t.id)
    tasks.splice(i, 1)
    if (selectedId.value === id) selectedId.value = tasks[0]?.id ?? null
  }

  function removeSelected() {
    removeTask(selectedId.value)
  }

  function removeAllTasks() {
    const ids = tasks.map((t) => t.id)
    for (const id of ids) removeTask(id)
  }

  function clearDoneTasks() {
    const ids = tasks.filter((t) => t.status === 'done').map((t) => t.id)
    for (const id of ids) removeTask(id)
  }

  let lastErrBackend = ''
  let lastCorsMsg = ''

  async function pumpDownloadQueue() {
    if (tasks.filter((t) => t.status === 'running').length >= effectiveMaxConcurrentTasks()) return
    const next = tasks.find((t) => t.status === 'queued')
    if (!next) return
    void runTaskWrapped(next, lastErrBackend, lastCorsMsg)
  }

  watch([taskConcurrencyMode, maxConcurrentTasksManual, pressureStrategy], () => {
    void pumpDownloadQueue()
  })

  async function runTaskWrapped(task: DownloadTask, errNeedBackend: string, corsMsg: string) {
    try {
      await runTask(task, errNeedBackend, corsMsg)
    } finally {
      void pumpDownloadQueue()
    }
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

  function startTask(id: string | null, errNeedBackend: string, corsMsg: string) {
    const task = id ? tasks.find((t) => t.id === id) : null
    if (!task || task.status === 'running' || task.status === 'done') return
    if (task.status === 'error') {
      resetTaskProgress(task)
      task.status = 'queued'
    }
    lastErrBackend = errNeedBackend
    lastCorsMsg = corsMsg
    void runTaskWrapped(task, errNeedBackend, corsMsg)
  }

  function restartTask(id: string | null, errNeedBackend: string, corsMsg: string) {
    const task = id ? tasks.find((t) => t.id === id) : null
    if (!task || task.status === 'running') return
    task.abort?.abort()
    resetTaskProgress(task)
    task.status = 'queued'
    startTask(id, errNeedBackend, corsMsg)
  }

  function startSelected(errNeedBackend: string, corsMsg: string) {
    startTask(selectedId.value, errNeedBackend, corsMsg)
  }

  function startAll(errNeedBackend: string, corsMsg: string) {
    lastErrBackend = errNeedBackend
    lastCorsMsg = corsMsg
    const pending = tasks.filter((t) => t.status === 'queued' || t.status === 'paused' || t.status === 'error')
    for (const t of pending) {
      startTask(t.id, errNeedBackend, corsMsg)
    }
  }

  function pauseTask(id: string | null) {
    const task = id ? tasks.find((t) => t.id === id) : null
    if (!task || task.status !== 'running') return
    task.abort?.abort()
  }

  function pauseAll() {
    for (const t of tasks) {
      if (t.status === 'running') t.abort?.abort()
    }
  }

  function pauseSelected() {
    pauseTask(selectedId.value)
  }

  const runningDownloadCount = computed(() => tasks.filter((t) => t.status === 'running').length)

  return {
    tasks,
    selectedId,
    selectedTask,
    runningDownloadCount,
    sessionDownloadInfo,
    enqueueTask,
    setTaskThreadOverride,
    selectTask,
    removeTask,
    removeSelected,
    removeAllTasks,
    clearDoneTasks,
    startTask,
    restartTask,
    startSelected,
    startAll,
    pauseTask,
    pauseAll,
    pauseSelected,
  }
}
