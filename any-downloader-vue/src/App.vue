<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { detectProtocol, protocolLabel, expandLegacyDownloadLink } from './utils/protocol'
import type { ProtocolDetectResult } from './utils/protocol'
import {
  useDownloads,
  sessionDownloadInfo,
  sessionIoStats,
  bytesReceivedForDisplay,
  taskCommLogs,
  type DownloadTask,
  type SingleConnReason,
} from './composables/useDownloads'
import { useDownloadPolicy, effectiveMaxConcurrentTasks } from './composables/useDownloadPolicy'
import { useDownloadThreads } from './composables/useDownloadThreads'
import { useI18n } from './composables/useI18n'
import { useLog } from './composables/useLog'
import { useSpeedTest } from './composables/useSpeedTest'
import { useTheme } from './composables/useTheme'
import { useElectronShell } from './composables/useElectronShell'
import { useElectronVideo } from './composables/useElectronVideo'
import { pickSaveLocation, pickSaveDirectory, type SavePickResult } from './utils/savePicker'
import {
  extractHttpLinksFromPage,
  guessNameFromUrl,
  classifyDownloadUrl,
  type PageResourceKind,
  type RichPageLink,
} from './utils/extractPageLinks'
import { extractUrlsFromText } from './utils/parseUrlsFromText'
import { extractUrlsFromFileStream } from './utils/streamExtractUrlsFromFile'
import { DOWNLOAD_METHOD_GROUPS } from './data/downloadMethodCatalog'
import type { ChunkSlotState } from './composables/useDownloads'

const { strings, setLocale, locale } = useI18n()
const { lines, copyAll, log, notify, statusHintText, statusHintLevel } = useLog()
const { setMode } = useTheme()
const {
  isElectron,
  shellVersion,
  maximized,
  useNativeOsChrome,
  winMinimize,
  winMaximizeToggle,
  winClose,
} = useElectronShell()

const {
  videoModalOpen,
  videoUrl,
  videoOutDir,
  videoLog,
  videoRunning,
  ytdlpAvailable,
  ytdlpVia,
  openVideoDownloadModal,
  closeVideoDownloadModal,
  recheckYtdlp,
  pickVideoDir,
  cancelVideoDownload,
  startVideoDownload,
} = useElectronVideo()

function onVideoDownloadModalClose() {
  if (videoRunning.value) void cancelVideoDownload()
  closeVideoDownloadModal()
}

function runElectronVideoDownload() {
  void startVideoDownload(
    {
      errInvalidUrl: strings.value.errInvalidUrl,
      errVideoNoDir: strings.value.errVideoNoDir,
      errVideoNoYtdlp: strings.value.errVideoNoYtdlp,
      errVideoFailed: strings.value.errVideoFailed,
      notifyVideoDone: strings.value.notifyVideoDone,
      notifyVideoCancelled: strings.value.notifyVideoCancelled,
    },
    notify,
  )
}

const appVersion = computed(() => {
  const v = shellVersion.value?.trim()
  if (v) return v
  return __APP_VERSION__
})

watch(
  () => [strings.value.appTitle, appVersion.value] as const,
  () => {
    const v = appVersion.value.trim()
    document.title = v ? `${strings.value.appTitle} v${v}` : strings.value.appTitle
  },
  { immediate: true },
)

function onShellChromeContextMenu(e: MouseEvent) {
  if (!isElectron) return
  e.preventDefault()
  const shell = window.anyDownloaderShell
  void shell?.popupShellChromeMenu?.({
    clientX: e.clientX,
    clientY: e.clientY,
    labels: { nativeChrome: strings.value.shellMenuNativeChrome },
  })
}
const {
  tasks,
  selectedId,
  selectedTask,
  runningDownloadCount,
  enqueueTask,
  selectTask,
  removeTask,
  startTask,
  restartTask,
  startAll,
  pauseAll,
  removeAllTasks,
  clearDoneTasks,
  pauseTask,
  setTaskThreadOverride,
} = useDownloads()
const { mode: threadMode, manualCount } = useDownloadThreads()
const { taskConcurrencyMode, maxConcurrentTasksManual, pressureStrategy } = useDownloadPolicy()

const concurrentLimit = computed(() => effectiveMaxConcurrentTasks())
const { running: speedRunning, regions, uploadMbps, uploadError, lastError, runAll, setRegionLabels } = useSpeedTest()

const logOpen = ref(false)
const helpOpen = ref(false)
const aboutOpen = ref(false)
const methodsOpen = ref(false)
const pageModalOpen = ref(false)
const addModalOpen = ref(false)
const addPasteText = ref('')
const addModalTa = ref<HTMLTextAreaElement | null>(null)
interface AddParsedRow {
  id: string
  raw: string
  det: ProtocolDetectResult | null
  kind: PageResourceKind
  canEnqueue: boolean
  selected: boolean
}
const addParsedRows = ref<AddParsedRow[]>([])

/** 列表渲染上限，避免单页百万行拖垮 DOM */
const MAX_ADD_MODAL_URLS = 25_000
const addImportFileInput = ref<HTMLInputElement | null>(null)
const importFileBusy = ref(false)
const importFilePhase = ref<'reading' | 'building'>('reading')
const importFileLoaded = ref(0)
const importFileTotal = ref(0)
let importAbortController: AbortController | null = null

watch(addModalOpen, (open) => {
  if (!open) importAbortController?.abort()
})

const leftDockWide = ref(300)
const rightDockWide = ref(320)
const draggingSplit = ref(false)
const dragTarget = ref<'left' | 'right' | null>(null)

const pageUrl = ref('https://example.com/')
const pageRichLinks = ref<RichPageLink[]>([])
const pageSelected = reactive<Record<string, boolean>>({})
const pageKindVisibility = reactive<Partial<Record<PageResourceKind, boolean>>>({})
const pageDirHandle = ref<FileSystemDirectoryHandle | null>(null)
/** Electron：原生对话框返回的完整目录路径，用于展示与 IPC 落盘 */
const pageDirFullPath = ref<string | null>(null)
const pageFetchBusy = ref(false)

const pageDirDisplayLine = computed(() => {
  if (pageDirFullPath.value) return pageDirFullPath.value
  if (pageDirHandle.value) return pageDirHandle.value.name
  return ''
})

const pageDirBrowserOnlyNameHint = computed(() => !!(pageDirHandle.value && !pageDirFullPath.value))

/** Electron：上次选择的网页导入目录，关闭弹窗/重启应用后仍保留 */
const PAGE_IMPORT_DIR_STORAGE_KEY = 'any-downloader-page-import-dir'

function loadPersistedPageImportDir() {
  if (typeof localStorage === 'undefined') return
  try {
    if (!window.anyDownloaderShell) return
    const raw = localStorage.getItem(PAGE_IMPORT_DIR_STORAGE_KEY)
    const p = raw?.trim()
    if (p) pageDirFullPath.value = p
  } catch {
    /* ignore */
  }
}

function persistPageImportDir(path: string) {
  if (typeof localStorage === 'undefined') return
  try {
    if (!window.anyDownloaderShell) return
    localStorage.setItem(PAGE_IMPORT_DIR_STORAGE_KEY, path.trim())
  } catch {
    /* ignore */
  }
}

watch(pageModalOpen, (open) => {
  if (!open) pageFetchBusy.value = false
})

const visiblePageLinks = computed(() =>
  pageRichLinks.value.filter((r) => pageKindVisibility[r.kind] !== false),
)

const pageKindChips = computed(() => {
  const m = new Map<PageResourceKind, { total: number; downloadable: number }>()
  for (const row of pageRichLinks.value) {
    const e = m.get(row.kind) ?? { total: 0, downloadable: 0 }
    e.total++
    if (row.canTryHttpDownload) e.downloadable++
    m.set(row.kind, e)
  }
  return [...m.entries()]
    .map(([kind, v]) => ({ kind, ...v }))
    .sort((a, b) => String(a.kind).localeCompare(String(b.kind)))
})

function pageKindDownloadableRows(kind: PageResourceKind) {
  return pageRichLinks.value.filter((r) => r.kind === kind && r.canTryHttpDownload)
}

function pageKindAllSelected(kind: PageResourceKind) {
  const rows = pageKindDownloadableRows(kind)
  if (!rows.length) return false
  return rows.every((r) => pageSelected[r.url])
}

function pageKindSomeSelected(kind: PageResourceKind) {
  const rows = pageKindDownloadableRows(kind)
  if (!rows.length) return false
  const n = rows.filter((r) => pageSelected[r.url]).length
  return n > 0 && n < rows.length
}

/** 对勾：全选则清空该类型可下载项，否则全选该类型可下载项 */
function togglePageKindSelection(kind: PageResourceKind) {
  const rows = pageKindDownloadableRows(kind)
  if (!rows.length) return
  const all = pageKindAllSelected(kind)
  const v = !all
  for (const r of rows) pageSelected[r.url] = v
}

type LeftDockKey = 'speed' | 'global'
type RightDockKey = 'info' | 'chunks' | 'comm'

const leftDockPanel = ref({ speed: false, global: true })
const rightDockPanel = ref({ info: true, chunks: true, comm: true })
const leftDockMax = ref<LeftDockKey | null>(null)
const rightDockMax = ref<RightDockKey | null>(null)

const ctx = ref<{ x: number; y: number; taskId: string } | null>(null)

const taskThreadInput = ref('')

const leftDockExpanded = computed(() => leftDockPanel.value.speed || leftDockPanel.value.global)
const rightDockExpanded = computed(
  () => rightDockPanel.value.info || rightDockPanel.value.chunks || rightDockPanel.value.comm,
)

watch(
  () => selectedTask.value?.threadOverride,
  (v) => {
    taskThreadInput.value = v != null ? String(v) : ''
  },
  { immediate: true },
)

watch(
  locale,
  (l) => {
    setRegionLabels(l)
  },
  { immediate: true },
)

watch([leftDockExpanded, rightDockExpanded], () => {
  if (!leftDockExpanded.value && !rightDockExpanded.value) draggingSplit.value = false
})

const commLogPanelText = computed(() => {
  const t = selectedTask.value
  if (!t) return strings.value.dockCommEmptyNoSel
  const lines = taskCommLogs[t.id]
  if (!lines?.length) return strings.value.dockCommEmptyNoLog
  return lines.join('\n')
})

const catalogLocale = computed(() => (locale.value === 'zh' ? 'zh' : 'en'))

const statusSummary = computed(() => {
  const n = tasks.length
  const run = runningDownloadCount.value
  const lim = concurrentLimit.value
  return `${strings.value.ready} · ${n} ${strings.value.tasksCount} · ${strings.value.statusConcurrent} ${run}/${lim}${run > 0 ? ' ↓' : ''}`
})

const aggregateSpeedBps = computed(() =>
  tasks.reduce((s, t) => (t.status === 'running' ? s + t.speedBps : s), 0),
)

/** 驱动列表内「已用/剩余」时间每秒级刷新 */
const uiTick = ref(0)
const globalSpeedHistory = ref<number[]>([])
const diskWriteHistory = ref<number[]>([])
let globalAggregateTimer: ReturnType<typeof setInterval> | null = null

const globalSparkPolyline = computed(() => {
  const h = globalSpeedHistory.value
  if (h.length < 2) return ''
  const maxV = Math.max(...h, 1)
  return h
    .map((v, i) => {
      const x = (i / (h.length - 1)) * 100
      const y = 32 - (v / maxV) * 28
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
})

const diskSparkPolyline = computed(() => {
  const h = diskWriteHistory.value
  if (h.length < 2) return ''
  const maxV = Math.max(...h, 1)
  return h
    .map((v, i) => {
      const x = (i / (h.length - 1)) * 100
      const y = 32 - (v / maxV) * 28
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
})

const globalModeDisplay = computed(() => {
  const si = sessionDownloadInfo
  if (si.connectionKind === 'parallel' && si.activeThreads != null) {
    return locale.value === 'zh' ? `多连接 · ${si.activeThreads} 路` : `Parallel · ${si.activeThreads}`
  }
  if (si.connectionKind === 'single') {
    return locale.value === 'zh' ? '单连接' : 'Single connection'
  }
  return locale.value === 'zh' ? '空闲' : 'Idle'
})

const bottleneckDisplay = computed(() => {
  const k = sessionDownloadInfo.bottleneck
  if (k === 'no_range') return strings.value.bottleneckNoRange
  if (k === 'unknown_size') return strings.value.bottleneckUnknownSize
  return strings.value.bottleneckNone
})

const threadPolicyDisplay = computed(() => {
  if (threadMode.value === 'auto') return strings.value.threadAuto
  return `${strings.value.threadManual} · ${manualCount.value}`
})

function formatDurationSec(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return strings.value.timeNA
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  return `${m}:${String(r).padStart(2, '0')}`
}

function formatTaskElapsed(t: DownloadTask): string {
  if (t.runStartedAt == null) return strings.value.timeNA
  if (t.status === 'done' || t.status === 'error') {
    const end = t.runFinishedAt ?? Date.now()
    return formatDurationSec((end - t.runStartedAt) / 1000)
  }
  void uiTick.value
  return formatDurationSec((Date.now() - t.runStartedAt) / 1000)
}

function formatTaskEta(t: DownloadTask): string {
  void uiTick.value
  if (t.isWriting || t.status !== 'running' || !t.totalBytes || t.speedBps < 256) return strings.value.timeNA
  const got = bytesReceivedForDisplay(t)
  const left = t.totalBytes - got
  if (left <= 0) return strings.value.timeNA
  return formatDurationSec(left / t.speedBps)
}

function taskConnDisplay(t: DownloadTask): string {
  if (t.status !== 'running') return strings.value.timeNA
  if (t.isWriting) return strings.value.timeNA
  return String(t.activeConnections)
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B'
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const globalSparkLive = computed(() => {
  void uiTick.value
  return `${strings.value.sparkCurrentNet}: ${formatBytes(aggregateSpeedBps.value)}/s`
})

const diskSparkLive = computed(() => {
  void uiTick.value
  return `${strings.value.sparkCurrentDisk}: ${formatBytes(sessionIoStats.writeBps)}/s`
})

const taskSparkLive = computed(() => {
  void uiTick.value
  const t = selectedTask.value
  if (!t) return '—'
  return `${strings.value.sparkCurrentNet}: ${formatBytes(t.speedBps)}/s`
})

/** 未完成前最高显示 99%，避免与「正在保存」语义冲突 */
function displayProgressPercent(t: DownloadTask): number {
  const raw = Math.round(Math.min(1, Math.max(0, t.progress)) * 100)
  if (t.status === 'done') return 100
  if (t.status === 'running' || t.status === 'queued') return Math.min(99, raw)
  return raw
}

function singleConnReasonText(r: SingleConnReason): string | null {
  if (r === 'none') return null
  const m: Record<string, string> = {
    unknown_size: strings.value.singleReasonUnknownSize,
    range_not_accepted: strings.value.singleReasonRangeRejected,
    parallel_no_range: strings.value.singleReasonParallelNoRange,
  }
  return m[r] ?? null
}

function formatMbps(v: number | null): string {
  if (v == null || Number.isNaN(v)) return '—'
  return `${v.toFixed(2)} Mbit/s`
}

const sparkPolyline = computed(() => {
  const h = selectedTask.value?.speedHistory ?? []
  if (h.length < 2) return ''
  const maxV = Math.max(...h, 1)
  return h
    .map((v, i) => {
      const x = (i / (h.length - 1)) * 100
      const y = 32 - (v / maxV) * 28
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
})

function linkKindLabel(kind: PageResourceKind): string {
  const m: Record<PageResourceKind, string> = {
    http_link: strings.value.linkCatHttp,
    static_asset: strings.value.linkCatStatic,
    video_src: strings.value.linkCatVideo,
    audio_src: strings.value.linkCatAudio,
    hls: strings.value.linkCatHls,
    dash: strings.value.linkCatDash,
    embed_page: strings.value.linkCatEmbed,
    other: strings.value.linkCatOther,
  }
  return m[kind]
}

function pageLinkHint(row: RichPageLink): string {
  if (!row.canTryHttpDownload) {
    if (row.kind === 'hls') return strings.value.linkHintHls
    if (row.kind === 'dash') return strings.value.linkHintDash
    if (row.kind === 'embed_page') return strings.value.linkHintEmbed
  }
  return strings.value.linkHintDirectHttp
}

function addModalRowHint(row: AddParsedRow): string {
  if (!row.det || row.det.protocol === 'unknown') return strings.value.linkUnknownProto
  const p = row.det.protocol
  if (
    ['magnet', 'ed2k', 'thunder', 'flashget', 'qqdl', 'ftp', 'ftps', 'sftp', 's3', 'dav', 'davs', 'ws', 'wss'].includes(
      p,
    )
  )
    return strings.value.linkHintNeedEngine
  if (row.kind === 'hls') return strings.value.linkHintHls
  if (row.kind === 'dash') return strings.value.linkHintDash
  if (row.kind === 'embed_page') return strings.value.linkHintEmbed
  return strings.value.linkHintDirectHttp
}

async function openAddModal(prefill?: string) {
  addModalOpen.value = true
  addParsedRows.value = []
  if (prefill !== undefined) {
    addPasteText.value = prefill
  } else {
    try {
      const clip = await navigator.clipboard.readText()
      if (clip) addPasteText.value = clip
    } catch {
      notify('warn', strings.value.errClipboardRead)
    }
  }
  void nextTick(() => {
    addModalTa.value?.focus()
    if (addPasteText.value.trim()) parseAddModal()
  })
}

async function openAddModalFresh() {
  addPasteText.value = ''
  await openAddModal()
}

function makeAddParsedRow(raw: string, i: number): AddParsedRow {
  const expanded = expandLegacyDownloadLink(raw)
  const det = detectProtocol(expanded)
  const href = det?.href ?? expanded
  const { kind } = classifyDownloadUrl(href)
  const protoOk = det != null && det.protocol !== 'unknown'
  const httpFamily = det != null && ['http', 'https', 'blob', 'data'].includes(det.protocol)
  const canEnqueue = !!(protoOk && httpFamily && kind !== 'embed_page' && kind !== 'hls' && kind !== 'dash')
  return {
    id: `p-${i}`,
    raw,
    det,
    kind,
    canEnqueue,
    selected: canEnqueue,
  }
}

function parseAddModal() {
  const urls = extractUrlsFromText(addPasteText.value)
  if (addPasteText.value.trim() && urls.length === 0) {
    notify('warn', strings.value.errNoUrlsParsed)
  }
  addParsedRows.value = urls.map((raw, i) => makeAddParsedRow(raw, i))
}

function cancelImportFromFile() {
  importAbortController?.abort()
}

async function onAddImportFileChange(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  if (!addModalOpen.value) addModalOpen.value = true
  await nextTick()

  importFileBusy.value = true
  importFilePhase.value = 'reading'
  importFileLoaded.value = 0
  importFileTotal.value = file.size
  importAbortController?.abort()
  importAbortController = new AbortController()
  const ac = importAbortController

  try {
    const { urls, aborted } = await extractUrlsFromFileStream(file, {
      signal: ac.signal,
      onProgress: (loaded, total) => {
        importFileLoaded.value = loaded
        importFileTotal.value = total
      },
    })

    if (aborted) {
      notify('warn', strings.value.addImportCancelled)
      return
    }

    importFilePhase.value = 'building'
    importFileLoaded.value = importFileTotal.value
    const totalFound = urls.length
    const limited = urls.slice(0, MAX_ADD_MODAL_URLS)
    if (totalFound > MAX_ADD_MODAL_URLS) {
      notify(
        'warn',
        strings.value.addImportTruncated.replace('{n}', String(totalFound)).replace('{m}', String(MAX_ADD_MODAL_URLS)),
      )
    }

    addParsedRows.value = []
    addPasteText.value =
      totalFound > 0
        ? `（${strings.value.addImportFromFileSummary} · ${totalFound}${totalFound > MAX_ADD_MODAL_URLS ? ` · ≤${MAX_ADD_MODAL_URLS}` : ''}）`
        : ''

    const BATCH = 300
    for (let i = 0; i < limited.length; i += BATCH) {
      if (ac.signal.aborted) {
        notify('warn', strings.value.addImportCancelled)
        return
      }
      const slice = limited.slice(i, i + BATCH).map((raw, j) => makeAddParsedRow(raw, i + j))
      addParsedRows.value.push(...slice)
      await new Promise<void>((r) => setTimeout(r, 0))
    }

    if (totalFound === 0) notify('warn', strings.value.errNoUrlsParsed)
    else notify('info', strings.value.addImportDone.replace('{n}', String(totalFound)))
  } catch (e) {
    const err = e as Error
    if (err.name === 'AbortError') notify('warn', strings.value.addImportCancelled)
    else notify('error', `${strings.value.addImportFailed}: ${err.message}`)
  } finally {
    importFileBusy.value = false
    importAbortController = null
  }
}

function openAddImportFilePicker() {
  addImportFileInput.value?.click()
}

function addSelectAllOk() {
  for (const r of addParsedRows.value) {
    if (r.canEnqueue) r.selected = true
  }
}

function addDeselectAllModal() {
  for (const r of addParsedRows.value) r.selected = false
}

async function enqueueAddModalSelections(startNow: boolean) {
  const rows = addParsedRows.value.filter((r) => r.selected && r.canEnqueue && r.det)
  if (!rows.length) {
    notify('warn', strings.value.addNoSelection)
    return
  }
  let dir: FileSystemDirectoryHandle | null = null
  if (rows.length > 1) {
    try {
      dir = await pickSaveDirectory()
    } catch (e) {
      notify('error', `${strings.value.errDirPicker}: ${(e as Error).message}`)
      return
    }
    if (!dir) {
      notify('warn', strings.value.pageDirRequired)
      return
    }
  }
  const before = tasks.length
  for (const row of rows) {
    const det = row.det!
    const name = guessNameFromUrl(det.href)
    let save: SavePickResult | null = null
    if (dir) {
      try {
        const h = await dir.getFileHandle(name, { create: true })
        save = { fileName: name, handle: h }
      } catch (e) {
        const msg = `${name}: ${(e as Error).message}`
        log('error', msg)
        notify('error', msg)
        continue
      }
    } else {
      save = await pickSaveLocation(name)
      if (!save) {
        notify('warn', strings.value.errSaveCancelled)
        return
      }
    }
    enqueueTask(det, save)
  }
  if (tasks.length === before) {
    notify('warn', strings.value.errEnqueueNone)
    return
  }
  const added = tasks.slice(before)
  addModalOpen.value = false
  addPasteText.value = ''
  addParsedRows.value = []
  const doneMsg = (startNow ? strings.value.addDoneStarted : strings.value.addDoneQueued).replace('{n}', String(added.length))
  notify('info', doneMsg)
  if (startNow && added.length) {
    await Promise.all(added.map((t) => startTask(t.id, strings.value.errNeedBackend, strings.value.errCors)))
  }
}

function clearAndOpenAdd() {
  void openAddModalFresh()
}

async function pasteIntoAddModal() {
  try {
    addPasteText.value = await navigator.clipboard.readText()
    parseAddModal()
  } catch {
    notify('warn', strings.value.errClipboardRead)
  }
}

function applyPerTaskThreads() {
  const t = selectedTask.value
  if (!t) return
  const raw = taskThreadInput.value.trim()
  if (!raw) setTaskThreadOverride(t.id, null)
  else {
    const n = parseInt(raw, 10)
    if (!Number.isNaN(n) && n >= 1 && n <= 16) setTaskThreadOverride(t.id, n)
    else notify('warn', strings.value.threadInvalidRange)
  }
}

function statusLabel(s: string) {
  const m: Record<string, string> = {
    queued: strings.value.statusQueued,
    running: strings.value.statusRunning,
    paused: strings.value.statusPaused,
    done: strings.value.statusDone,
    error: strings.value.statusError,
  }
  return m[s] ?? s
}

function taskStatusLabel(t: DownloadTask): string {
  if (t.status === 'running' && t.isWriting) return strings.value.statusSaving
  return statusLabel(t.status)
}

async function onCopyLog() {
  const ok = await copyAll()
  if (ok) notify('info', strings.value.logCopiedOk)
  else notify('error', strings.value.errClipboardCopyLog)
}

function onSplitLeftDown(e: MouseEvent) {
  if (!leftDockExpanded.value) return
  dragTarget.value = 'left'
  draggingSplit.value = true
  e.preventDefault()
}

function onSplitRightDown(e: MouseEvent) {
  if (!rightDockExpanded.value) return
  dragTarget.value = 'right'
  draggingSplit.value = true
  e.preventDefault()
}

function onMove(e: MouseEvent) {
  if (!draggingSplit.value || !dragTarget.value) return
  const row = document.getElementById('main-row')
  if (!row) return
  const r = row.getBoundingClientRect()
  if (dragTarget.value === 'left') {
    leftDockWide.value = Math.min(Math.max(e.clientX - r.left, 200), 520)
  } else {
    rightDockWide.value = Math.min(Math.max(r.right - e.clientX - 40, 200), 560)
  }
}

function onUp() {
  draggingSplit.value = false
  dragTarget.value = null
}

function closeCtx() {
  ctx.value = null
}

function openCtx(e: MouseEvent, taskId: string) {
  e.preventDefault()
  e.stopPropagation()
  ctx.value = { x: e.clientX, y: e.clientY, taskId }
}

function ctxTask() {
  return tasks.find((t) => t.id === ctx.value?.taskId) ?? null
}

async function ctxStart() {
  const id = ctx.value?.taskId ?? null
  closeCtx()
  await startTask(id, strings.value.errNeedBackend, strings.value.errCors)
}

function ctxPause() {
  const id = ctx.value?.taskId ?? null
  closeCtx()
  pauseTask(id)
}

async function ctxRestart() {
  const id = ctx.value?.taskId ?? null
  closeCtx()
  await restartTask(id, strings.value.errNeedBackend, strings.value.errCors)
}

function ctxRemove() {
  const id = ctx.value?.taskId ?? null
  closeCtx()
  if (!id) return
  if (!window.confirm(strings.value.confirmRemoveTask)) return
  removeTask(id)
}

function onRemoveAllTasks() {
  if (!tasks.length) {
    notify('warn', strings.value.notifyNoTasksToRemove)
    return
  }
  if (!window.confirm(strings.value.confirmRemoveAll)) return
  removeAllTasks()
}

function onClearDoneTasks() {
  if (!tasks.some((t) => t.status === 'done')) {
    notify('warn', strings.value.notifyNoDoneToClear)
    return
  }
  if (!window.confirm(strings.value.confirmClearDone)) return
  clearDoneTasks()
}

async function ctxCopyUrl() {
  const t = ctxTask()
  closeCtx()
  if (!t) return
  try {
    await navigator.clipboard.writeText(t.href)
    notify('info', strings.value.urlCopiedOk)
  } catch {
    notify('warn', strings.value.errClipboardCopyLog)
  }
}

async function onRunSpeed() {
  await runAll(locale.value)
  if (lastError.value) {
    notify('error', `${strings.value.speedTestRunFailed}: ${lastError.value}`, { persist: true })
    return
  }
  const n = regions.length
  if (n > 0 && regions.every((r) => r.downloadError)) {
    notify('error', strings.value.speedAllDownloadsFailed, { persist: true })
  }
}

function resetPageKindVisibility() {
  for (const k of Object.keys(pageKindVisibility) as PageResourceKind[]) {
    delete pageKindVisibility[k]
  }
  for (const row of pageRichLinks.value) {
    pageKindVisibility[row.kind] = true
  }
}

function togglePageKindVisible(kind: PageResourceKind) {
  const cur = pageKindVisibility[kind] !== false
  pageKindVisibility[kind] = !cur
}

async function fetchPageLinks() {
  if (pageFetchBusy.value) return
  pageFetchBusy.value = true
  try {
    const r = await extractHttpLinksFromPage(pageUrl.value)
    if (r.error) {
      const msg = `${strings.value.pageFetchFailed}: ${r.error}`
      log('error', msg)
      notify('error', msg, { persist: true })
      pageRichLinks.value = []
      for (const k of Object.keys(pageSelected)) delete pageSelected[k]
      for (const key of Object.keys(pageKindVisibility) as PageResourceKind[]) delete pageKindVisibility[key]
      return
    }
    pageRichLinks.value = r.links
    for (const k of Object.keys(pageSelected)) delete pageSelected[k]
    resetPageKindVisibility()
    for (const row of r.links) {
      pageSelected[row.url] = row.canTryHttpDownload
    }
    if (!r.links.length) notify('warn', strings.value.pageNoLinks)
  } finally {
    pageFetchBusy.value = false
  }
}

async function choosePageDir() {
  try {
    const shell = window.anyDownloaderShell
    if (shell?.pickImportDirectory) {
      const picked = await shell.pickImportDirectory()
      if (picked && typeof picked.path === 'string' && picked.path.trim()) {
        const dirPath = picked.path.trim()
        pageDirFullPath.value = dirPath
        pageDirHandle.value = null
        persistPageImportDir(dirPath)
        return
      }
      return
    }
    pageDirFullPath.value = null
    const d = await pickSaveDirectory()
    pageDirHandle.value = d
    if (!d) notify('warn', strings.value.pageDirRequired)
  } catch (e) {
    notify('error', `${strings.value.errDirPicker}: ${(e as Error).message}`)
  }
}

function pageSelectAll(v: boolean) {
  for (const row of visiblePageLinks.value) {
    pageSelected[row.url] = row.canTryHttpDownload ? v : false
  }
}

async function openPageImportModal() {
  pageModalOpen.value = true
  await nextTick()
  try {
    const t = await navigator.clipboard.readText()
    const u = t.trim()
    if (!u) return
    if (/^https?:\/\//i.test(u)) {
      pageUrl.value = u
      return
    }
    const urls = extractUrlsFromText(u)
    const first = urls.find((x) => /^https?:\/\//i.test(x))
    if (first) pageUrl.value = first
  } catch {
    notify('warn', strings.value.errClipboardRead)
  }
}

async function addSelectedFromPage(startNow: boolean) {
  const dir = pageDirHandle.value
  const electronDir = pageDirFullPath.value?.trim() || null
  if (!dir && !electronDir) {
    notify('warn', strings.value.pageDirRequired)
    return
  }
  const before = tasks.length
  for (const row of pageRichLinks.value) {
    if (!pageSelected[row.url] || !row.canTryHttpDownload) continue
    const det = detectProtocol(row.url)
    if (!det || det.protocol === 'unknown') continue
    if (!['http', 'https', 'blob', 'data'].includes(det.protocol)) continue
    const name = guessNameFromUrl(det.href)
    try {
      if (electronDir) {
        enqueueTask(det, { fileName: name, handle: null, electronOutputDir: electronDir })
      } else {
        const handle = await dir!.getFileHandle(name, { create: true })
        enqueueTask(det, { fileName: name, handle })
      }
    } catch (e) {
      const msg = `${name}: ${(e as Error).message}`
      log('error', msg)
      notify('error', msg)
    }
  }
  if (tasks.length === before) {
    notify('warn', strings.value.pageNoSelection)
    return
  }
  const added = tasks.slice(before)
  const doneMsg = (startNow ? strings.value.addDoneStarted : strings.value.addDoneQueued).replace('{n}', String(added.length))
  notify('info', doneMsg)
  pageModalOpen.value = false
  if (startNow && added.length) {
    await Promise.all(added.map((t) => startTask(t.id, strings.value.errNeedBackend, strings.value.errCors)))
  }
}

function chunkClass(s: ChunkSlotState): string {
  if (s === 'done') return 'chunk-done'
  if (s === 'active') return 'chunk-active'
  if (s === 'paused') return 'chunk-paused'
  return 'chunk-pending'
}

function onF1(e: KeyboardEvent) {
  if (e.key === 'F1') {
    e.preventDefault()
    helpOpen.value = true
  }
}

function toggleLeftDock(k: LeftDockKey) {
  leftDockPanel.value[k] = !leftDockPanel.value[k]
  if (leftDockMax.value === k && !leftDockPanel.value[k]) leftDockMax.value = null
}

function toggleRightDock(k: RightDockKey) {
  rightDockPanel.value[k] = !rightDockPanel.value[k]
  if (rightDockMax.value === k && !rightDockPanel.value[k]) rightDockMax.value = null
}

function toggleLeftMax(k: LeftDockKey) {
  if (!leftDockPanel.value[k]) return
  leftDockMax.value = leftDockMax.value === k ? null : k
}

function toggleRightMax(k: RightDockKey) {
  if (!rightDockPanel.value[k]) return
  rightDockMax.value = rightDockMax.value === k ? null : k
}

onMounted(() => {
  loadPersistedPageImportDir()
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  window.addEventListener('keydown', onF1)
  window.addEventListener('click', closeCtx)
  globalAggregateTimer = setInterval(() => {
    uiTick.value++
    const v = aggregateSpeedBps.value
    globalSpeedHistory.value = [...globalSpeedHistory.value, v].slice(-80)
    const dw = sessionIoStats.writeBps
    diskWriteHistory.value = [...diskWriteHistory.value, dw].slice(-80)
    sessionIoStats.writeBps *= 0.88
    if (sessionIoStats.writeBps < 400) sessionIoStats.writeBps = 0
  }, 300)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', onUp)
  window.removeEventListener('keydown', onF1)
  window.removeEventListener('click', closeCtx)
  if (globalAggregateTimer != null) {
    clearInterval(globalAggregateTimer)
    globalAggregateTimer = null
  }
})
</script>

<template>
  <div
    class="app-root"
    :class="{
      'is-dragging': draggingSplit,
      'is-electron-shell': isElectron,
      'native-os-chrome': isElectron && useNativeOsChrome,
    }"
  >
    <header
      id="title-strip"
      class="title-strip"
      :title="isElectron ? strings.shellTitleContextHint : undefined"
      @contextmenu="onShellChromeContextMenu"
    >
      <div class="title-strip-drag">
        <img class="app-icon" src="/favicon.svg" width="20" height="20" alt="" />
        <span class="app-name">{{ strings.appTitle }}</span>
        <span v-if="appVersion" class="app-version muted">v{{ appVersion }}</span>
      </div>
      <div
        v-if="isElectron && !useNativeOsChrome"
        class="shell-window-controls"
        role="group"
        :aria-label="strings.shellWindowControlsAria"
      >
        <button
          type="button"
          class="shell-win-btn shell-win-min"
          :title="strings.shellWinMin"
          :aria-label="strings.shellWinMin"
          @click="winMinimize"
        >
          &#x2012;
        </button>
        <button
          type="button"
          class="shell-win-btn shell-win-max"
          :title="maximized ? strings.shellWinRestore : strings.shellWinMax"
          :aria-label="maximized ? strings.shellWinRestore : strings.shellWinMax"
          @click="winMaximizeToggle"
        >
          {{ maximized ? '\u25a3' : '\u25a1' }}
        </button>
        <button
          type="button"
          class="shell-win-btn shell-win-close"
          :title="strings.shellWinClose"
          :aria-label="strings.shellWinClose"
          @click="winClose"
        >
          &#x2715;
        </button>
      </div>
    </header>
    <nav id="menu-bar" class="menu-bar" role="menubar" aria-label="Main">
      <div class="menu-top">
        <span class="menu-root">
          <button type="button" class="menu-button">{{ strings.menuFile }}</button>
          <div class="menu-dropdown">
            <button type="button" class="menu-item" @click="clearAndOpenAdd">
              {{ strings.addUrl }}
            </button>
            <button type="button" class="menu-item" @click="openAddImportFilePicker">
              {{ strings.addImportFromFile }}
            </button>
            <button type="button" class="menu-item" @click="void openPageImportModal()">{{ strings.pageFromWeb }}</button>
            <button
              v-if="isElectron"
              type="button"
              class="menu-item"
              @click="openVideoDownloadModal"
            >
              {{ strings.menuVideoDownload }}
            </button>
            <button type="button" class="menu-item" @click="void startAll(strings.errNeedBackend, strings.errCors)">
              {{ strings.toolbarAllStart }}
            </button>
            <button type="button" class="menu-item" @click="pauseAll">{{ strings.toolbarAllPause }}</button>
            <button type="button" class="menu-item" @click="onRemoveAllTasks">{{ strings.toolbarAllRemove }}</button>
            <button type="button" class="menu-item" @click="onClearDoneTasks">{{ strings.toolbarClearDone }}</button>
            <button v-if="isElectron" type="button" class="menu-item" @click="winClose">{{ strings.shellQuitApp }}</button>
          </div>
        </span>
        <span class="menu-root">
          <button type="button" class="menu-button">{{ strings.menuLang }}</button>
          <div class="menu-dropdown">
            <button type="button" class="menu-item" @click="setLocale('zh')">{{ strings.langZh }}</button>
            <button type="button" class="menu-item" @click="setLocale('en')">{{ strings.langEn }}</button>
          </div>
        </span>
        <span class="menu-root">
          <button type="button" class="menu-button">{{ strings.menuTheme }}</button>
          <div class="menu-dropdown">
            <button type="button" class="menu-item" @click="setMode('system')">{{ strings.themeSystem }}</button>
            <button type="button" class="menu-item" @click="setMode('light')">{{ strings.themeLight }}</button>
            <button type="button" class="menu-item" @click="setMode('dark')">{{ strings.themeDark }}</button>
          </div>
        </span>
        <span class="menu-root">
          <button type="button" class="menu-button">{{ strings.menuWindow }}</button>
          <div class="menu-dropdown">
            <button type="button" class="menu-item" @click="toggleLeftDock('speed')">{{ strings.winDockLeftSpeed }}</button>
            <button type="button" class="menu-item" @click="toggleLeftDock('global')">{{ strings.winDockGlobal }}</button>
            <button type="button" class="menu-item" @click="toggleRightDock('info')">{{ strings.winDockInfo }}</button>
            <button type="button" class="menu-item" @click="toggleRightDock('chunks')">{{ strings.winDockChunks }}</button>
            <button type="button" class="menu-item" @click="toggleRightDock('comm')">{{ strings.winDockCommLog }}</button>
          </div>
        </span>
        <span class="menu-root">
          <button type="button" class="menu-button">{{ strings.menuHelp }}</button>
          <div class="menu-dropdown">
            <button type="button" class="menu-item" title="F1" @click="helpOpen = true">{{ strings.helpInfo }}</button>
            <button type="button" class="menu-item" @click="methodsOpen = true">{{ strings.downloadMethods }}</button>
            <button type="button" class="menu-item" @click="aboutOpen = true">{{ strings.about }}</button>
          </div>
        </span>
      </div>
    </nav>

    <div
      id="toolbar"
      class="toolbar"
      @contextmenu="onShellChromeContextMenu"
    >
      <button
        type="button"
        class="tb-btn tb-icon"
        :aria-label="strings.toolbarAdd"
        :title="strings.toolbarAdd"
        @click="void openAddModalFresh()"
      >
        ➕
      </button>
      <button
        type="button"
        class="tb-btn tb-icon"
        :aria-label="strings.addImportFromFile"
        :title="strings.addImportFromFile"
        @click="openAddImportFilePicker"
      >
        📄
      </button>
      <button
        type="button"
        class="tb-btn tb-icon"
        :aria-label="strings.pageFromWeb"
        :title="strings.pageFromWeb"
        @click="void openPageImportModal()"
      >
        🌐
      </button>
      <button
        v-if="isElectron"
        type="button"
        class="tb-btn tb-icon"
        :aria-label="strings.toolbarVideoDownload"
        :title="strings.toolbarVideoDownload"
        @click="openVideoDownloadModal"
      >
        🎬
      </button>
      <span class="tb-sep" />
      <button
        type="button"
        class="tb-btn tb-icon"
        :aria-label="strings.toolbarAllStart"
        :title="strings.toolbarAllStart"
        @click="void startAll(strings.errNeedBackend, strings.errCors)"
      >
        ▶
      </button>
      <button type="button" class="tb-btn tb-icon" :aria-label="strings.toolbarAllPause" :title="strings.toolbarAllPause" @click="pauseAll">
        ⏸
      </button>
      <button
        type="button"
        class="tb-btn tb-icon"
        :aria-label="strings.toolbarAllRemove"
        :title="strings.toolbarAllRemove"
        @click="onRemoveAllTasks"
      >
        🗑
      </button>
      <button
        type="button"
        class="tb-btn tb-icon"
        :aria-label="strings.toolbarClearDone"
        :title="strings.toolbarClearDone"
        @click="onClearDoneTasks"
      >
        ✓
      </button>
    </div>

    <div id="main-row" class="main-row">
      <aside
        id="dock-area-left"
        class="dock-area dock-left"
        :class="{ 'dock-collapsed': !leftDockExpanded }"
        :style="{ width: leftDockExpanded ? `${leftDockWide}px` : '40px' }"
      >
        <div id="dock-button-bar-left" class="dock-button-bar dock-button-bar-outer" role="toolbar" aria-label="Left dock">
          <button
            type="button"
            class="dock-btn"
            :class="{ active: leftDockPanel.speed }"
            :title="strings.winDockLeftSpeed"
            @click="toggleLeftDock('speed')"
          >
            ⚡
          </button>
          <button
            type="button"
            class="dock-btn"
            :class="{ active: leftDockPanel.global }"
            :title="strings.winDockGlobal"
            @click="toggleLeftDock('global')"
          >
            ◉
          </button>
        </div>
        <div v-show="leftDockExpanded" id="dock-view-left" class="dock-view">
          <section
            v-show="leftDockPanel.speed && (!leftDockMax || leftDockMax === 'speed')"
            class="dock-card"
            :class="{ 'dock-card-max': leftDockMax === 'speed' }"
          >
            <header class="dock-head">
              <span>{{ strings.winDockLeftSpeed }}</span>
              <div class="dock-head-actions">
                <button
                  type="button"
                  class="dock-max"
                  :title="leftDockMax === 'speed' ? strings.dockRestore : strings.dockMaximize"
                  @click.stop="toggleLeftMax('speed')"
                >
                  {{ leftDockMax === 'speed' ? '⤓' : '⛶' }}
                </button>
                <button type="button" class="dock-fold" :title="strings.noShortcut" @click="toggleLeftDock('speed')">
                  ▾
                </button>
              </div>
            </header>
            <div class="dock-body speed-body">
              <button type="button" class="tb-btn full" :disabled="speedRunning" @click="onRunSpeed">
                {{ speedRunning ? strings.speedTesting : strings.speedTest }}
              </button>
              <p class="muted small">{{ strings.speedUploadNote }}</p>
              <p class="muted small">{{ strings.speedPingNote }}</p>
              <table class="speed-table" aria-label="Regional speed">
                <thead>
                  <tr>
                    <th>{{ strings.speedColRegion }}</th>
                    <th>{{ strings.speedColPing }}</th>
                    <th>{{ strings.speedColDown }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in regions" :key="r.id">
                    <td>{{ r.label }}</td>
                    <td>
                      <span v-if="r.pingError" class="err-small">{{ r.pingError }}</span>
                      <span v-else-if="r.pingMs != null">{{ r.pingMs }} ms</span>
                      <span v-else class="muted">—</span>
                    </td>
                    <td>
                      <span v-if="r.downloadError" class="err-small">{{ r.downloadError }}</span>
                      <span v-else>{{ formatMbps(r.downloadMbps) }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p class="speed-res">
                {{ strings.speedUploadLabel }}: <strong>{{ formatMbps(uploadMbps) }}</strong>
              </p>
              <p v-if="uploadError" class="err-small">{{ uploadError }}</p>
              <p v-if="lastError" class="err-small">{{ lastError }}</p>
            </div>
          </section>

          <section
            v-show="leftDockPanel.global && (!leftDockMax || leftDockMax === 'global')"
            class="dock-card"
            :class="{ 'dock-card-max': leftDockMax === 'global' }"
          >
            <header class="dock-head">
              <span>{{ strings.winDockGlobal }}</span>
              <div class="dock-head-actions">
                <button
                  type="button"
                  class="dock-max"
                  :title="leftDockMax === 'global' ? strings.dockRestore : strings.dockMaximize"
                  @click.stop="toggleLeftMax('global')"
                >
                  {{ leftDockMax === 'global' ? '⤓' : '⛶' }}
                </button>
                <button type="button" class="dock-fold" :title="strings.noShortcut" @click="toggleLeftDock('global')">
                  ▾
                </button>
              </div>
            </header>
            <div class="dock-body global-body">
              <p>
                <strong>{{ strings.globalSpeed }}</strong><br />
                <span class="mono">{{ formatBytes(aggregateSpeedBps) }}/s</span>
              </p>
              <div class="global-spark-block spark-wrap">
                <div class="spark-label-row">
                  <strong>{{ strings.globalSpeedCurve }}</strong>
                  <span class="spark-live mono">{{ globalSparkLive }}</span>
                </div>
                <svg class="spark-svg global-spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
                  <polyline v-if="globalSparkPolyline" class="spark-line" fill="none" :points="globalSparkPolyline" />
                </svg>
              </div>
              <div class="global-spark-block spark-wrap">
                <div class="spark-label-row">
                  <strong>{{ strings.diskWriteCurve }}</strong>
                  <span class="spark-live mono">{{ diskSparkLive }}</span>
                </div>
                <svg class="spark-svg global-spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
                  <polyline v-if="diskSparkPolyline" class="spark-line spark-line-disk" fill="none" :points="diskSparkPolyline" />
                </svg>
              </div>
              <p>
                <strong>{{ strings.globalMode }}</strong><br />
                {{ globalModeDisplay }}
              </p>
              <p>
                <strong>{{ strings.globalBottleneck }}</strong><br />
                {{ bottleneckDisplay }}
              </p>
              <p>
                <strong>{{ strings.policyConcurrency }}</strong><br />
                <label class="inline-label"
                  ><input v-model="taskConcurrencyMode" type="radio" value="auto" /> {{ strings.policyConcurrencyAuto }}</label
                >
                <label class="inline-label"
                  ><input v-model="taskConcurrencyMode" type="radio" value="manual" /> {{ strings.policyConcurrencyManual }}</label
                >
              </p>
              <p>
                <label>{{ strings.policyMaxTasks }} (1–16)</label>
                <input v-model.number="maxConcurrentTasksManual" class="thread-inp" type="number" min="1" max="16" />
              </p>
              <p class="muted small">{{ strings.policyMaxTasksHint }}</p>
              <p>
                <strong>{{ strings.policyPressure }}</strong><br />
                <label class="inline-label"
                  ><input v-model="pressureStrategy" type="radio" value="min" /> {{ strings.pressureMin }}</label
                >
                <label class="inline-label"
                  ><input v-model="pressureStrategy" type="radio" value="balanced" /> {{ strings.pressureBalanced }}</label
                >
                <label class="inline-label"
                  ><input v-model="pressureStrategy" type="radio" value="max" /> {{ strings.pressureMax }}</label
                >
              </p>
              <p class="muted small">
                <span v-if="pressureStrategy === 'min'">{{ strings.pressureMinHint }}</span>
                <span v-else-if="pressureStrategy === 'max'">{{ strings.pressureMaxHint }}</span>
                <span v-else>{{ strings.pressureBalancedHint }}</span>
              </p>
              <p>
                <strong>{{ strings.threadPolicy }}</strong><br />
                <label class="inline-label"><input v-model="threadMode" type="radio" value="auto" /> {{ strings.threadAuto }}</label>
                <label class="inline-label"><input v-model="threadMode" type="radio" value="manual" /> {{ strings.threadManual }}</label>
              </p>
              <p v-show="threadMode === 'manual'">
                <label>{{ strings.threadCountLabel }}</label>
                <input v-model.number="manualCount" class="thread-inp" type="number" min="1" max="16" />
              </p>
            </div>
          </section>
        </div>
      </aside>

      <div
        class="splitter splitter-left"
        :class="{ 'splitter-inactive': !leftDockExpanded }"
        role="separator"
        aria-orientation="vertical"
        :title="leftDockExpanded ? strings.noShortcut : strings.splitterLeftDockCollapsed"
        @mousedown="onSplitLeftDown"
      />

      <main id="download-list" class="download-list" role="main">
        <table class="dl-table" aria-label="Downloads">
          <thead>
            <tr>
              <th>{{ strings.colName }}</th>
              <th class="col-narrow">{{ strings.colProtocol }}</th>
              <th class="col-mid">{{ strings.colProgress }}</th>
              <th>{{ strings.colStatus }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="tasks.length === 0">
              <td colspan="4" class="empty-hint">{{ strings.urlPlaceholder }}</td>
            </tr>
            <tr
              v-for="t in tasks"
              :key="t.id"
              :class="{ selected: t.id === selectedId }"
              @click="selectTask(t.id)"
              @contextmenu="openCtx($event, t.id)"
            >
              <td class="cell-ellipsis" :title="t.displayUrl">{{ t.displayUrl }}</td>
              <td class="col-narrow mono">{{ protocolLabel(t.protocol) }}</td>
              <td class="col-mid">
                <div class="prog-wrap">
                  <div class="prog-bar" :style="{ width: `${displayProgressPercent(t)}%` }" />
                </div>
                <span class="prog-txt">{{ displayProgressPercent(t) }}%</span>
                <div class="prog-meta mono">
                  <span :title="strings.taskElapsed">{{ strings.taskElapsed }} {{ formatTaskElapsed(t) }}</span>
                  ·
                  <span :title="strings.taskRemaining">{{ strings.taskRemaining }} {{ formatTaskEta(t) }}</span>
                  ·
                  <span :title="strings.taskConnections">{{ strings.taskConnections }} {{ taskConnDisplay(t) }}</span>
                </div>
              </td>
              <td>
                <span class="st" :data-s="t.status">{{ taskStatusLabel(t) }}</span>
                <span v-if="t.status === 'error' && t.errorMessage" class="err-small"> — {{ t.errorMessage }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </main>

      <div
        class="splitter splitter-right"
        :class="{ 'splitter-inactive': !rightDockExpanded }"
        role="separator"
        aria-orientation="vertical"
        :title="rightDockExpanded ? strings.noShortcut : strings.splitterDockCollapsed"
        @mousedown="onSplitRightDown"
      />

      <aside
        id="dock-area-right"
        class="dock-area dock-right"
        :class="{ 'dock-collapsed': !rightDockExpanded }"
        :style="{ width: rightDockExpanded ? `${rightDockWide}px` : '40px' }"
      >
        <div v-show="rightDockExpanded" id="dock-view-right" class="dock-view">
          <section
            v-show="rightDockPanel.info && (!rightDockMax || rightDockMax === 'info')"
            class="dock-card"
            :class="{ 'dock-card-max': rightDockMax === 'info' }"
          >
            <header class="dock-head">
              <span>{{ strings.winDockInfo }}</span>
              <div class="dock-head-actions">
                <button
                  type="button"
                  class="dock-max"
                  :title="rightDockMax === 'info' ? strings.dockRestore : strings.dockMaximize"
                  @click.stop="toggleRightMax('info')"
                >
                  {{ rightDockMax === 'info' ? '⤓' : '⛶' }}
                </button>
                <button type="button" class="dock-fold" :title="strings.noShortcut" @click="toggleRightDock('info')">
                  ▾
                </button>
              </div>
            </header>
            <div v-if="selectedTask" class="dock-body mono">
              <p><strong>URL</strong><br />{{ selectedTask.displayUrl }}</p>
              <p class="dock-stats-line">
                <span
                  ><strong>{{ strings.dockBytes }}</strong> {{ formatBytes(bytesReceivedForDisplay(selectedTask)) }}</span
                >
                <span class="dock-stat-sep" aria-hidden="true">·</span>
                <span
                  ><strong>{{ strings.dockTotal }}</strong>
                  {{
                    selectedTask.totalBytes != null ? formatBytes(selectedTask.totalBytes) : strings.timeNA
                  }}</span
                >
                <span class="dock-stat-sep" aria-hidden="true">·</span>
                <span
                  ><strong>{{ strings.dockSpeed }}</strong> {{ formatBytes(selectedTask.speedBps) }}/s</span
                >
              </p>
              <p v-if="singleConnReasonText(selectedTask.singleConnReason)">
                <strong>{{ strings.dockSingleConnNote }}</strong><br />
                <span class="muted small">{{ singleConnReasonText(selectedTask.singleConnReason) }}</span>
              </p>
              <p class="thread-override-block">
                <strong>{{ strings.threadPerTaskLabel }}</strong><br />
                <span class="muted small">{{ strings.threadUseGlobalHint }} · {{ threadPolicyDisplay }}</span><br />
                <input
                  v-model="taskThreadInput"
                  class="thread-inp"
                  type="text"
                  inputmode="numeric"
                  placeholder="1–16"
                  @change="applyPerTaskThreads"
                />
              </p>
              <div v-if="selectedTask" class="spark-wrap">
                <div class="spark-label-row">
                  <span class="spark-label">{{ strings.dockSpeedCurve }} (B/s)</span>
                  <span class="spark-live mono">{{ taskSparkLive }}</span>
                </div>
                <svg
                  v-if="selectedTask.speedHistory.length >= 2"
                  class="spark-svg"
                  viewBox="0 0 100 34"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <polyline class="spark-line" :points="sparkPolyline" fill="none" />
                </svg>
              </div>
            </div>
            <p v-else class="dock-body muted">{{ strings.dockNoSelection }}</p>
          </section>

          <section
            v-show="rightDockPanel.chunks && (!rightDockMax || rightDockMax === 'chunks')"
            class="dock-card"
            :class="{ 'dock-card-max': rightDockMax === 'chunks' }"
          >
            <header class="dock-head">
              <span>{{ strings.winDockChunks }}</span>
              <div class="dock-head-actions">
                <button
                  type="button"
                  class="dock-max"
                  :title="rightDockMax === 'chunks' ? strings.dockRestore : strings.dockMaximize"
                  @click.stop="toggleRightMax('chunks')"
                >
                  {{ rightDockMax === 'chunks' ? '⤓' : '⛶' }}
                </button>
                <button type="button" class="dock-fold" :title="strings.noShortcut" @click="toggleRightDock('chunks')">
                  ▾
                </button>
              </div>
            </header>
            <div class="dock-body">
              <p class="muted small">{{ strings.chunkHint }}</p>
              <div v-if="selectedTask" class="chunk-legend">
                <span class="lg chunk-done">{{ strings.chunkLegendDone }}</span>
                <span class="lg chunk-active">{{ strings.chunkLegendActive }}</span>
                <span class="lg chunk-paused">{{ strings.chunkLegendPaused }}</span>
                <span class="lg chunk-pending">{{ strings.chunkLegendPending }}</span>
              </div>
              <div v-if="selectedTask" class="chunk-grid">
                <div
                  v-for="(st, i) in selectedTask.chunkSlots"
                  :key="i"
                  class="chunk-cell"
                  :class="chunkClass(st)"
                  :style="
                    st === 'active' || st === 'paused'
                      ? { '--chunk-fill': String(Math.min(1, Math.max(0, selectedTask.chunkFill[i] ?? 0))) }
                      : undefined
                  "
                  :title="`${i + 1}/${selectedTask.chunkSlots.length} · ${Math.round((selectedTask.chunkFill[i] ?? 0) * 100)}%`"
                />
              </div>
              <p v-else class="muted">{{ strings.dockNoSelection }}</p>
            </div>
          </section>

          <section
            v-show="rightDockPanel.comm && (!rightDockMax || rightDockMax === 'comm')"
            class="dock-card dock-card-comm-inline"
            :class="{ 'dock-card-max': rightDockMax === 'comm' }"
          >
            <header class="dock-head">
              <span>{{ strings.winDockCommLog }}</span>
              <div class="dock-head-actions">
                <button
                  type="button"
                  class="dock-max"
                  :title="rightDockMax === 'comm' ? strings.dockRestore : strings.dockMaximize"
                  @click.stop="toggleRightMax('comm')"
                >
                  {{ rightDockMax === 'comm' ? '⤓' : '⛶' }}
                </button>
                <button type="button" class="dock-fold" :title="strings.noShortcut" @click="toggleRightDock('comm')">
                  ▾
                </button>
              </div>
            </header>
            <div class="dock-body dock-body-comm">
              <p class="muted small dock-comm-hint">{{ strings.dockCommHint }}</p>
              <pre class="comm-log-pre comm-log-pre-dock" tabindex="0">{{ commLogPanelText }}</pre>
            </div>
          </section>
        </div>

        <div id="dock-button-bar-right" class="dock-button-bar dock-button-bar-outer" role="toolbar" aria-label="Right dock">
          <button
            type="button"
            class="dock-btn"
            :class="{ active: rightDockPanel.info }"
            :title="strings.winDockInfo"
            @click="toggleRightDock('info')"
          >
            ℹ
          </button>
          <button
            type="button"
            class="dock-btn"
            :class="{ active: rightDockPanel.chunks }"
            :title="strings.winDockChunks"
            @click="toggleRightDock('chunks')"
          >
            ▦
          </button>
          <button
            type="button"
            class="dock-btn"
            :class="{ active: rightDockPanel.comm }"
            :title="strings.winDockCommLog"
            @click="toggleRightDock('comm')"
          >
            📡
          </button>
        </div>
      </aside>
    </div>

    <footer
      id="status-bar"
      class="status-bar"
      role="status"
      :title="strings.statusClickLog"
      tabindex="0"
      @click="logOpen = true"
      @keydown.enter.prevent="logOpen = true"
    >
      <div class="status-bar-main">
        {{ statusSummary }} · {{ strings.threadPolicy }}: {{ threadPolicyDisplay }}
      </div>
      <div
        v-if="statusHintText"
        class="status-bar-hint"
        :class="statusHintLevel ? `hint-${statusHintLevel}` : ''"
      >
        {{ statusHintText }}
      </div>
    </footer>

    <div
      v-if="ctx"
      class="ctx-menu"
      :style="{ left: `${ctx.x}px`, top: `${ctx.y}px` }"
      @mousedown.stop
      @click.stop
    >
      <button type="button" class="ctx-item" @click="ctxStart">{{ strings.ctxStart }}</button>
      <button type="button" class="ctx-item" @click="ctxPause">{{ strings.ctxPause }}</button>
      <button type="button" class="ctx-item" @click="void ctxRestart()">{{ strings.ctxRestart }}</button>
      <button type="button" class="ctx-item" @click="ctxRemove">{{ strings.ctxRemove }}</button>
      <button type="button" class="ctx-item" @click="ctxCopyUrl">{{ strings.ctxCopyUrl }}</button>
    </div>

    <div v-if="logOpen" class="modal-backdrop" role="presentation" @click.self="logOpen = false">
      <div class="modal log-modal" role="dialog" aria-labelledby="log-h">
        <header class="modal-head">
          <h2 id="log-h">{{ strings.logTitle }}</h2>
          <button type="button" class="icon-btn" @click="onCopyLog">{{ strings.logCopy }}</button>
          <button type="button" class="icon-btn" @click="logOpen = false">{{ strings.logClose }}</button>
        </header>
        <pre class="log-pre" tabindex="0">{{ lines.length ? lines.join('\n') : strings.logEmpty }}</pre>
      </div>
    </div>

    <div v-if="helpOpen" class="modal-backdrop" @click.self="helpOpen = false">
      <div class="modal" role="dialog" aria-labelledby="help-h">
        <header class="modal-head">
          <h2 id="help-h">{{ strings.helpInfo }}</h2>
          <button type="button" class="icon-btn" @click="helpOpen = false">{{ strings.logClose }}</button>
        </header>
        <pre class="help-pre">{{ strings.helpText }}</pre>
      </div>
    </div>

    <div v-if="methodsOpen" class="modal-backdrop" @click.self="methodsOpen = false">
      <div class="modal methods-modal" role="dialog" aria-labelledby="meth-h">
        <header class="modal-head">
          <h2 id="meth-h">{{ strings.downloadMethods }}</h2>
          <button type="button" class="icon-btn" @click="methodsOpen = false">{{ strings.logClose }}</button>
        </header>
        <div class="methods-body">
          <section v-for="(g, gi) in DOWNLOAD_METHOD_GROUPS" :key="gi" class="meth-group">
            <h3>{{ g.title[catalogLocale] }}</h3>
            <table class="meth-table">
              <thead>
                <tr>
                  <th>Protocol</th>
                  <th>{{ catalogLocale === 'zh' ? '方式' : 'How' }}</th>
                  <th>{{ catalogLocale === 'zh' ? '测试地址' : 'Test URL' }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, ri) in g.rows" :key="ri">
                  <td class="mono">{{ row.protocol }}</td>
                  <td>{{ row.how[catalogLocale] }}</td>
                  <td class="mono break">{{ row.testUrl || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>

    <input
      ref="addImportFileInput"
      class="visually-hidden-file"
      type="file"
      accept=".txt,.text,.log,.lst,.list,.url,.urls,.csv,text/plain,*/*"
      @change="onAddImportFileChange"
    />

    <div v-if="addModalOpen" class="modal-backdrop" @click.self="addModalOpen = false">
      <div class="modal add-modal" role="dialog" aria-labelledby="add-h">
        <header class="modal-head">
          <h2 id="add-h">{{ strings.addModalTitle }}</h2>
          <button type="button" class="icon-btn" @click="addModalOpen = false">{{ strings.logClose }}</button>
        </header>
        <div class="add-modal-body" :class="{ 'add-modal-body-busy': importFileBusy }">
          <div v-if="importFileBusy" class="add-import-panel" role="status">
            <p class="add-import-status">
              {{ importFilePhase === 'reading' ? strings.addImportReading : strings.addImportBuilding }}
            </p>
            <progress
              class="add-import-progress"
              :value="importFileLoaded"
              :max="Math.max(importFileTotal, 1)"
            />
            <p class="small mono add-import-bytes">
              {{ formatBytes(importFileLoaded) }} / {{ formatBytes(importFileTotal) }}
            </p>
            <button type="button" class="tb-btn" @click="cancelImportFromFile">{{ strings.addImportCancel }}</button>
          </div>
          <p class="muted small">{{ strings.addPasteHint }}</p>
          <textarea
            ref="addModalTa"
            v-model="addPasteText"
            class="add-paste-ta"
            rows="8"
            spellcheck="false"
            :disabled="importFileBusy"
          />
          <div class="add-modal-actions add-modal-actions-top">
            <button type="button" class="tb-btn" @click="parseAddModal" :disabled="importFileBusy">
              {{ strings.addParseBtn }}
            </button>
            <button type="button" class="tb-btn" @click="addSelectAllOk" :disabled="importFileBusy">
              {{ strings.addSelectOk }}
            </button>
            <button type="button" class="tb-btn" @click="addDeselectAllModal" :disabled="importFileBusy">
              {{ strings.addDeselectAll }}
            </button>
            <button type="button" class="tb-btn" @click="pasteIntoAddModal" :disabled="importFileBusy">
              {{ strings.addPasteFromClipboard }}
            </button>
            <button type="button" class="tb-btn" @click="openAddImportFilePicker" :disabled="importFileBusy">
              {{ strings.addImportFromFile }}
            </button>
          </div>
          <div v-if="addParsedRows.length" class="add-parse-wrap">
            <table class="add-parse-table">
              <thead>
                <tr>
                  <th class="col-cb" />
                  <th>{{ strings.addColLink }}</th>
                  <th>{{ strings.addColKind }}</th>
                  <th>{{ strings.addColProto }}</th>
                  <th>{{ strings.addColHint }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in addParsedRows" :key="row.id" :class="{ 'row-muted': !row.canEnqueue }">
                  <td class="col-cb">
                    <input v-model="row.selected" type="checkbox" :disabled="!row.canEnqueue" />
                  </td>
                  <td class="mono break">{{ row.raw }}</td>
                  <td>{{ linkKindLabel(row.kind) }}</td>
                  <td class="mono">{{ row.det ? protocolLabel(row.det.protocol) : '—' }}</td>
                  <td class="small">{{ addModalRowHint(row) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="add-modal-actions add-modal-actions-bottom">
            <button
              type="button"
              class="tb-btn primary"
              :disabled="importFileBusy"
              @click="enqueueAddModalSelections(true)"
            >
              {{ strings.addStartSelected }}
            </button>
            <button type="button" class="tb-btn" :disabled="importFileBusy" @click="enqueueAddModalSelections(false)">
              {{ strings.addQueueSelected }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="videoModalOpen && isElectron"
      class="modal-backdrop"
      role="presentation"
      @click.self="onVideoDownloadModalClose"
    >
      <div class="modal page-modal" role="dialog" aria-labelledby="video-dl-h">
        <header class="modal-head">
          <h2 id="video-dl-h">{{ strings.videoDownloadTitle }}</h2>
          <button type="button" class="icon-btn" @click="onVideoDownloadModalClose">{{ strings.logClose }}</button>
        </header>
        <div class="page-body">
          <p class="muted small">{{ strings.videoDownloadHint }}</p>
          <p v-if="ytdlpAvailable === true" class="small video-ytdlp-status-ok">
            {{ strings.videoYtdlpOk }}
            <span v-if="ytdlpVia" class="mono"> · {{ strings.videoYtdlpViaPrefix }} {{ ytdlpVia }}</span>
          </p>
          <p v-else-if="ytdlpAvailable === false" class="small err-small">{{ strings.videoYtdlpMissing }}</p>
          <p v-else class="small muted">{{ strings.videoDownloadRecheckYtdlp }}…</p>
          <div class="page-actions">
            <button type="button" class="tb-btn" :disabled="videoRunning" @click="void recheckYtdlp()">
              {{ strings.videoDownloadRecheckYtdlp }}
            </button>
            <button type="button" class="tb-btn" @click="void pickVideoDir()">{{ strings.videoDownloadPickDir }}</button>
          </div>
          <p v-if="videoOutDir" class="small mono break">📁 {{ videoOutDir }}</p>
          <label class="page-label">{{ strings.videoDownloadUrlLabel }}</label>
          <input v-model="videoUrl" class="url-input page-url-inp" type="url" :disabled="videoRunning" />
          <p class="small muted">{{ strings.videoDownloadLogLabel }}</p>
          <pre class="log-pre video-ytdlp-log">{{ videoLog || '—' }}</pre>
          <div class="page-actions page-actions-footer">
            <button
              type="button"
              class="tb-btn primary"
              :disabled="videoRunning || ytdlpAvailable === false"
              @click="runElectronVideoDownload"
            >
              {{ strings.videoDownloadStart }}
            </button>
            <button type="button" class="tb-btn" :disabled="!videoRunning" @click="void cancelVideoDownload()">
              {{ strings.videoDownloadCancelOp }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="pageModalOpen" class="modal-backdrop" @click.self="pageModalOpen = false">
      <div class="modal page-modal" role="dialog" aria-labelledby="page-h">
        <header class="modal-head">
          <h2 id="page-h">{{ strings.pageImportTitle }}</h2>
          <button type="button" class="icon-btn" @click="pageModalOpen = false">{{ strings.logClose }}</button>
        </header>
        <div class="page-body">
          <p class="muted small">{{ strings.pageImportHint }}</p>
          <label class="page-label">{{ strings.pageUrlLabel }}</label>
          <input v-model="pageUrl" class="url-input page-url-inp" type="url" :disabled="pageFetchBusy" />
          <p v-if="pageFetchBusy" class="page-fetch-hint" role="status">{{ strings.pageFetching }}</p>
          <div class="page-actions page-actions-with-dir">
            <button type="button" class="tb-btn" :disabled="pageFetchBusy" @click="void fetchPageLinks()">
              {{ strings.pageFetch }}
            </button>
            <button type="button" class="tb-btn" :disabled="pageFetchBusy" @click="void choosePageDir()">
              {{ strings.pagePickDir }}
            </button>
            <div class="page-dir-inline">
              <template v-if="pageDirDisplayLine">
                <span class="page-dir-label-inline">{{ strings.pageDirSelectedLabel }}</span>
                <span class="small mono break page-dir-path-inline">📁 {{ pageDirDisplayLine }}</span>
                <span v-if="pageDirBrowserOnlyNameHint" class="small muted page-dir-note-inline">{{
                  strings.pageDirNameOnlyNote
                }}</span>
              </template>
            </div>
          </div>
          <div class="page-actions page-actions-select-row">
            <button type="button" class="tb-btn" :disabled="pageFetchBusy" @click="pageSelectAll(true)">
              {{ strings.pageSelectAll }}
            </button>
            <button type="button" class="tb-btn" :disabled="pageFetchBusy" @click="pageSelectAll(false)">
              {{ strings.pageClear }}
            </button>
          </div>
          <div v-if="pageKindChips.length" class="page-kind-section">
            <p class="small muted page-kind-hint">{{ strings.pageKindFilter }}</p>
            <div class="page-kind-chips">
              <div v-for="c in pageKindChips" :key="c.kind" class="page-kind-chip-wrap">
                <button
                  type="button"
                  class="page-kind-chip"
                  :class="{ 'page-kind-chip-off': pageKindVisibility[c.kind] === false }"
                  @click="togglePageKindVisible(c.kind)"
                >
                  {{ linkKindLabel(c.kind) }} ({{ c.total }})
                </button>
                <button
                  type="button"
                  class="page-kind-tick"
                  :class="{
                    'page-kind-tick-all': pageKindAllSelected(c.kind),
                    'page-kind-tick-partial': pageKindSomeSelected(c.kind),
                  }"
                  :disabled="c.downloadable === 0 || pageFetchBusy"
                  :title="strings.pageKindTickTitle"
                  :aria-label="strings.pageKindTickTitle"
                  :aria-pressed="pageKindAllSelected(c.kind)"
                  @click="togglePageKindSelection(c.kind)"
                >
                  <span class="page-kind-tick-mark" aria-hidden="true">✓</span>
                </button>
              </div>
            </div>
          </div>
          <div class="page-link-list">
            <p class="small">{{ strings.pageLinks }} ({{ visiblePageLinks.length }}/{{ pageRichLinks.length }})</p>
            <label v-for="row in visiblePageLinks" :key="row.url" class="page-link-row">
              <input v-model="pageSelected[row.url]" type="checkbox" :disabled="!row.canTryHttpDownload" />
              <span class="page-link-kind">{{ linkKindLabel(row.kind) }}</span>
              <span class="mono break page-link-url">{{ row.url }}</span>
              <span class="small muted page-link-hint">{{ pageLinkHint(row) }}</span>
            </label>
          </div>
          <div class="page-actions page-actions-footer">
            <button type="button" class="tb-btn primary" @click="addSelectedFromPage(true)">
              {{ strings.pageDownloadSelected }}
            </button>
            <button type="button" class="tb-btn" @click="addSelectedFromPage(false)">{{ strings.pageAddSelected }}</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="aboutOpen" class="modal-backdrop" @click.self="aboutOpen = false">
      <div class="modal" role="dialog" aria-labelledby="about-h">
        <header class="modal-head">
          <h2 id="about-h">{{ strings.about }}</h2>
          <button type="button" class="icon-btn" @click="aboutOpen = false">{{ strings.logClose }}</button>
        </header>
        <pre class="help-pre">{{ strings.aboutText }}</pre>
      </div>
    </div>
  </div>
</template>
