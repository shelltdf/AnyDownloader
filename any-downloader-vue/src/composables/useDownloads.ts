import { computed, reactive, ref } from 'vue'
import { detectProtocol, type DetectedProtocol } from '../utils/protocol'
import { useLog } from './useLog'

export type TaskStatus = 'queued' | 'running' | 'paused' | 'done' | 'error'

const CHUNK_SLOTS = 32

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
  errorMessage: string | null
  fileName: string
  chunks: boolean[]
  abort: AbortController | null
  buffer: Uint8Array[]
}

let idSeq = 1
function nextId() {
  return `t-${idSeq++}`
}

function emptyChunks(): boolean[] {
  return Array.from({ length: CHUNK_SLOTS }, () => false)
}

function updateChunksFromProgress(chunks: boolean[], progress: number) {
  const filled = Math.min(CHUNK_SLOTS, Math.floor(progress * CHUNK_SLOTS))
  for (let i = 0; i < CHUNK_SLOTS; i++) {
    chunks[i] = i < filled
  }
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

function triggerSave(blob: Blob, fileName: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = fileName
  a.click()
  URL.revokeObjectURL(a.href)
}

async function runHttpTask(task: DownloadTask, corsMsg: string) {
  const ac = new AbortController()
  task.abort = ac
  task.status = 'running'
  task.errorMessage = null
  task.buffer = []
  task.bytesReceived = 0
  task.speedBps = 0
  task.chunks.splice(0, CHUNK_SLOTS, ...emptyChunks())

  const t0 = performance.now()
  let lastT = t0
  let lastBytes = 0

  try {
    const res = await fetch(task.href, { signal: ac.signal, mode: 'cors' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const total = res.headers.get('content-length')
    task.totalBytes = total ? Number(total) : null
    task.fileName = guessFileName(task.href, res)

    const reader = res.body?.getReader()
    if (!reader) throw new Error('No body')

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        task.buffer.push(value)
        task.bytesReceived += value.length
        const now = performance.now()
        const dt = (now - lastT) / 1000
        if (dt >= 0.25) {
          task.speedBps = (task.bytesReceived - lastBytes) / dt
          lastT = now
          lastBytes = task.bytesReceived
        }
        if (task.totalBytes && task.totalBytes > 0) {
          task.progress = Math.min(1, task.bytesReceived / task.totalBytes)
        } else {
          task.progress = task.bytesReceived > 0 ? 0.05 : 0
        }
        updateChunksFromProgress(task.chunks, task.progress)
      }
    }

    if (task.totalBytes && task.totalBytes > 0) {
      task.progress = 1
    } else {
      task.progress = 1
    }
    updateChunksFromProgress(task.chunks, 1)

    const blob = new Blob(task.buffer as BlobPart[])
    task.buffer = []
    triggerSave(blob, task.fileName)
    task.status = 'done'
    log('info', `完成: ${task.fileName} (${task.bytesReceived} B)`)
  } catch (e) {
    const err = e as Error
    if (err.name === 'AbortError') {
      task.status = 'paused'
      task.errorMessage = null
      log('info', `已暂停: ${task.displayUrl}`)
    } else {
      task.status = 'error'
      const isNet =
        /failed to fetch|load failed|networkerror|aborted/i.test(err.message) ||
        err.name === 'TypeError'
      task.errorMessage = isNet ? corsMsg : err.message
      log('error', `${task.displayUrl}: ${err.message}`)
    }
  } finally {
    task.abort = null
  }
}

async function runDataTask(task: DownloadTask) {
  task.status = 'running'
  task.errorMessage = null
  try {
    const res = await fetch(task.href)
    const blob = await res.blob()
    task.bytesReceived = blob.size
    task.totalBytes = blob.size
    task.progress = 1
    task.chunks.splice(0, CHUNK_SLOTS, ...Array.from({ length: CHUNK_SLOTS }, () => true))
    task.fileName = 'data-download.bin'
    triggerSave(blob, task.fileName)
    task.status = 'done'
    log('info', `完成 data: (${blob.size} B)`)
  } catch (e) {
    task.status = 'error'
    task.errorMessage = (e as Error).message
    log('error', `data: ${task.errorMessage}`)
  }
}

function placeholderFail(task: DownloadTask, i18nKey: string) {
  task.status = 'error'
  task.errorMessage = i18nKey
  log('warn', `${task.protocol}: ${task.href}`)
}

export function useDownloads() {
  function addTask(raw: string, errInvalid: string): boolean {
    const det = detectProtocol(raw)
    if (!det || det.protocol === 'unknown') {
      log('error', errInvalid)
      return false
    }
    const task: DownloadTask = {
      id: nextId(),
      displayUrl: det.displayUrl,
      href: det.href,
      protocol: det.protocol,
      status: 'queued',
      progress: 0,
      bytesReceived: 0,
      totalBytes: null,
      speedBps: 0,
      errorMessage: null,
      fileName: '',
      chunks: emptyChunks(),
      abort: null,
      buffer: [],
    }
    tasks.push(task)
    selectedId.value = task.id
    log('info', `已添加 [${det.protocol}] ${det.displayUrl}`)
    return true
  }

  function selectTask(id: string | null) {
    selectedId.value = id
  }

  function removeSelected() {
    if (!selectedId.value) return
    const i = tasks.findIndex((t) => t.id === selectedId.value)
    if (i < 0) return
    const t = tasks[i]
    t.abort?.abort()
    tasks.splice(i, 1)
    selectedId.value = tasks[0]?.id ?? null
  }

  async function startSelected(errNeedBackend: string, corsMsg: string) {
    const task = selectedTask.value
    if (!task || task.status === 'running') return

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

  function pauseSelected() {
    const task = selectedTask.value
    if (!task || task.status !== 'running') return
    task.abort?.abort()
  }

  return {
    tasks,
    selectedId,
    selectedTask,
    addTask,
    selectTask,
    removeSelected,
    startSelected,
    pauseSelected,
  }
}
