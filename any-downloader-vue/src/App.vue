<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { detectProtocol, protocolLabel } from './utils/protocol'
import { useDownloads } from './composables/useDownloads'
import { useI18n } from './composables/useI18n'
import { useLog } from './composables/useLog'
import { useSpeedTest } from './composables/useSpeedTest'
import { useTheme } from './composables/useTheme'
import { pickSaveLocation, pickSaveDirectory } from './utils/savePicker'
import { extractHttpLinksFromPage, guessNameFromUrl } from './utils/extractPageLinks'
import { DOWNLOAD_METHOD_GROUPS } from './data/downloadMethodCatalog'
import type { ChunkSlotState } from './composables/useDownloads'

const { strings, setLocale, locale } = useI18n()
const { lines, copyAll, log } = useLog()
const { setMode } = useTheme()
const {
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
} = useDownloads()
const { running: speedRunning, regions, uploadMbps, uploadError, lastError, runAll, setRegionLabels } = useSpeedTest()

const urlInput = ref('')
const urlEl = ref<HTMLInputElement | null>(null)
const logOpen = ref(false)
const helpOpen = ref(false)
const aboutOpen = ref(false)
const methodsOpen = ref(false)
const pageModalOpen = ref(false)
const dockWide = ref(320)
const draggingSplit = ref(false)

const pageUrl = ref('https://example.com/')
const pageLinks = ref<string[]>([])
const pageSelected = reactive<Record<string, boolean>>({})
const pageDirHandle = ref<FileSystemDirectoryHandle | null>(null)

type DockKey = 'info' | 'speed' | 'chunks'
const dockPanel = ref({ info: true, speed: true, chunks: true })
const dockMax = ref<DockKey | null>(null)

const ctx = ref<{ x: number; y: number; taskId: string } | null>(null)

const dockExpanded = computed(() => dockPanel.value.info || dockPanel.value.speed || dockPanel.value.chunks)

watch(dockExpanded, (v) => {
  if (!v) draggingSplit.value = false
})

watch(
  locale,
  (l) => {
    setRegionLabels(l)
  },
  { immediate: true },
)

const catalogLocale = computed(() => (locale.value === 'zh' ? 'zh' : 'en'))

const statusSummary = computed(() => {
  const n = tasks.length
  const run = tasks.filter((t) => t.status === 'running').length
  return `${strings.value.ready} · ${n} ${strings.value.tasksCount}${run ? ` · ${run} ↓` : ''}`
})

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
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

function clearAndFocusUrl() {
  urlInput.value = ''
  void nextTick(() => urlEl.value?.focus())
}

async function prepareTaskFromInput(): Promise<boolean> {
  const raw = urlInput.value.trim()
  const det = detectProtocol(raw)
  if (!det || det.protocol === 'unknown') {
    log('error', strings.value.errInvalidUrl)
    return false
  }
  const suggest = guessNameFromUrl(det.href)
  const save = await pickSaveLocation(suggest)
  if (!save) return false
  enqueueTask(det, save)
  urlInput.value = ''
  return true
}

async function onAdd() {
  if (!(await prepareTaskFromInput())) return
  const id = selectedId.value
  await startTask(id, strings.value.errNeedBackend, strings.value.errCors)
}

async function onAddOnly() {
  await prepareTaskFromInput()
}

async function pasteAndAdd() {
  try {
    urlInput.value = await navigator.clipboard.readText()
  } catch {
    log('warn', 'Clipboard read failed')
    return
  }
  await onAdd()
}

function onStart() {
  void startSelected(strings.value.errNeedBackend, strings.value.errCors)
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

async function onCopyLog() {
  const ok = await copyAll()
  if (ok) log('info', 'Log copied.')
}

function onSplitDown(e: MouseEvent) {
  if (!dockExpanded.value) return
  draggingSplit.value = true
  e.preventDefault()
}

function onMove(e: MouseEvent) {
  if (!draggingSplit.value) return
  const row = document.getElementById('main-row')
  if (!row) return
  const r = row.getBoundingClientRect()
  const w = Math.min(Math.max(r.right - e.clientX - 56, 200), 560)
  dockWide.value = w
}

function onUp() {
  draggingSplit.value = false
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

function ctxRemove() {
  const id = ctx.value?.taskId ?? null
  closeCtx()
  removeTask(id)
}

async function ctxCopyUrl() {
  const t = ctxTask()
  closeCtx()
  if (!t) return
  try {
    await navigator.clipboard.writeText(t.href)
    log('info', 'URL copied')
  } catch {
    log('warn', 'Copy failed')
  }
}

async function onRunSpeed() {
  await runAll(locale.value)
}

async function fetchPageLinks() {
  const r = await extractHttpLinksFromPage(pageUrl.value)
  if (r.error) {
    log('error', r.error)
    pageLinks.value = []
    for (const k of Object.keys(pageSelected)) delete pageSelected[k]
    return
  }
  pageLinks.value = r.links
  for (const k of Object.keys(pageSelected)) delete pageSelected[k]
  for (const u of r.links) pageSelected[u] = true
  if (!r.links.length) log('warn', strings.value.pageNoLinks)
}

async function choosePageDir() {
  const d = await pickSaveDirectory()
  pageDirHandle.value = d
  if (!d) log('warn', strings.value.pageDirRequired)
}

function pageSelectAll(v: boolean) {
  for (const u of pageLinks.value) pageSelected[u] = v
}

async function addSelectedFromPage() {
  const dir = pageDirHandle.value
  if (!dir) {
    log('warn', strings.value.pageDirRequired)
    return
  }
  let n = 0
  for (const u of pageLinks.value) {
    if (!pageSelected[u]) continue
    const det = detectProtocol(u)
    if (!det || det.protocol === 'unknown') continue
    const name = guessNameFromUrl(det.href)
    try {
      const handle = await dir.getFileHandle(name, { create: true })
      enqueueTask(det, { fileName: name, handle })
      n++
    } catch (e) {
      log('error', `${name}: ${(e as Error).message}`)
    }
  }
  log('info', `Enqueued ${n} tasks`)
  pageModalOpen.value = false
}

function chunkClass(s: ChunkSlotState): string {
  if (s === 'done') return 'chunk-done'
  if (s === 'active') return 'chunk-active'
  return 'chunk-pending'
}

function onF1(e: KeyboardEvent) {
  if (e.key === 'F1') {
    e.preventDefault()
    helpOpen.value = true
  }
}

function toggleDock(k: DockKey) {
  dockPanel.value[k] = !dockPanel.value[k]
  if (dockMax.value === k && !dockPanel.value[k]) dockMax.value = null
}

function toggleMax(k: DockKey) {
  if (!dockPanel.value[k]) return
  dockMax.value = dockMax.value === k ? null : k
}

onMounted(() => {
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  window.addEventListener('keydown', onF1)
  window.addEventListener('click', closeCtx)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', onUp)
  window.removeEventListener('keydown', onF1)
  window.removeEventListener('click', closeCtx)
})
</script>

<template>
  <div class="app-root" :class="{ 'is-dragging': draggingSplit }">
    <header id="title-strip" class="title-strip">
      <img class="app-icon" src="/favicon.svg" width="20" height="20" alt="" />
      <span class="app-name">{{ strings.appTitle }}</span>
    </header>

    <nav id="menu-bar" class="menu-bar" role="menubar" aria-label="Main">
      <div class="menu-top">
        <span class="menu-root">
          <button type="button" class="menu-button">{{ strings.menuFile }}</button>
          <div class="menu-dropdown">
            <button type="button" class="menu-item" @click="clearAndFocusUrl">
              {{ strings.addUrl }}
            </button>
            <button type="button" class="menu-item" :title="strings.noShortcut" @click="onAddOnly">
              {{ strings.addUrlOnly }}
            </button>
            <button type="button" class="menu-item" @click="pageModalOpen = true">{{ strings.pageFromWeb }}</button>
            <button type="button" class="menu-item" @click="onStart">{{ strings.fileStart }}</button>
            <button type="button" class="menu-item" @click="pauseSelected">{{ strings.filePause }}</button>
            <button type="button" class="menu-item" @click="removeSelected">{{ strings.fileRemove }}</button>
          </div>
        </span>
        <span class="menu-root">
          <button type="button" class="menu-button">{{ strings.menuEdit }}</button>
          <div class="menu-dropdown">
            <button type="button" class="menu-item" @click="pasteAndAdd">
              {{ strings.pasteUrl }}
            </button>
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
            <button type="button" class="menu-item" @click="toggleDock('info')">{{ strings.winDockInfo }}</button>
            <button type="button" class="menu-item" @click="toggleDock('speed')">{{ strings.winDockSpeed }}</button>
            <button type="button" class="menu-item" @click="toggleDock('chunks')">{{ strings.winDockChunks }}</button>
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

    <div id="toolbar" class="toolbar">
      <input
        id="url-input"
        ref="urlEl"
        v-model="urlInput"
        class="url-input"
        type="url"
        autocomplete="off"
        :placeholder="strings.urlPlaceholder"
        @keydown.enter.prevent="onAdd"
      />
      <button type="button" class="tb-btn" :title="`${strings.toolbarAdd} · Enter`" @click="onAdd">
        ➕ {{ strings.toolbarAdd }}
      </button>
      <button type="button" class="tb-btn" :title="strings.addUrlOnly" @click="onAddOnly">
        📥 {{ strings.addUrlOnly }}
      </button>
      <button type="button" class="tb-btn" @click="pageModalOpen = true">{{ strings.pageFromWeb }}</button>
      <span class="tb-sep" />
      <button type="button" class="tb-btn" :title="strings.toolbarStart" @click="onStart">▶ {{ strings.start }}</button>
      <button type="button" class="tb-btn" :title="strings.toolbarPause" @click="pauseSelected">
        ⏸ {{ strings.pause }}
      </button>
      <button type="button" class="tb-btn" :title="strings.toolbarRemove" @click="removeSelected">
        🗑 {{ strings.remove }}
      </button>
    </div>

    <div id="main-row" class="main-row">
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
                  <div class="prog-bar" :style="{ width: `${Math.round(t.progress * 100)}%` }" />
                </div>
                <span class="prog-txt">{{ Math.round(t.progress * 100) }}%</span>
              </td>
              <td>
                <span class="st" :data-s="t.status">{{ statusLabel(t.status) }}</span>
                <span v-if="t.status === 'error' && t.errorMessage" class="err-small"> — {{ t.errorMessage }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </main>

      <div
        class="splitter"
        :class="{ 'splitter-inactive': !dockExpanded }"
        role="separator"
        aria-orientation="vertical"
        :aria-disabled="!dockExpanded"
        :title="dockExpanded ? strings.noShortcut : strings.splitterDockCollapsed"
        @mousedown="onSplitDown"
      />

      <aside
        id="dock-area"
        class="dock-area"
        :class="{ 'dock-collapsed': !dockExpanded }"
        :style="{ width: dockExpanded ? `${dockWide}px` : '44px' }"
      >
        <div v-show="dockExpanded" id="dock-view" class="dock-view">
          <section
            v-show="dockPanel.info && (!dockMax || dockMax === 'info')"
            class="dock-card"
            :class="{ 'dock-card-max': dockMax === 'info' }"
          >
            <header class="dock-head">
              <span>{{ strings.winDockInfo }}</span>
              <div class="dock-head-actions">
                <button
                  type="button"
                  class="dock-max"
                  :title="dockMax === 'info' ? strings.dockRestore : strings.dockMaximize"
                  @click.stop="toggleMax('info')"
                >
                  {{ dockMax === 'info' ? '⤓' : '⛶' }}
                </button>
                <button type="button" class="dock-fold" :title="strings.noShortcut" @click="toggleDock('info')">
                  ▾
                </button>
              </div>
            </header>
            <div v-if="selectedTask" class="dock-body mono">
              <p><strong>URL</strong><br />{{ selectedTask.displayUrl }}</p>
              <p>
                <strong>{{ strings.dockBytes }}</strong><br />{{ formatBytes(selectedTask.bytesReceived) }}
              </p>
              <p v-if="selectedTask.totalBytes">
                <strong>{{ strings.dockTotal }}</strong><br />{{ formatBytes(selectedTask.totalBytes) }}
              </p>
              <p v-if="selectedTask.status === 'running' || selectedTask.speedBps > 0">
                <strong>{{ strings.dockSpeed }}</strong><br />{{ formatBytes(selectedTask.speedBps) }}/s
              </p>
              <div v-if="selectedTask.speedHistory.length >= 2" class="spark-wrap">
                <div class="spark-label">{{ strings.dockSpeedCurve }} (B/s)</div>
                <svg class="spark-svg" viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true">
                  <polyline class="spark-line" :points="sparkPolyline" fill="none" />
                </svg>
              </div>
            </div>
            <p v-else class="dock-body muted">{{ strings.dockNoSelection }}</p>
          </section>

          <section
            v-show="dockPanel.speed && (!dockMax || dockMax === 'speed')"
            class="dock-card"
            :class="{ 'dock-card-max': dockMax === 'speed' }"
          >
            <header class="dock-head">
              <span>{{ strings.winDockSpeed }}</span>
              <div class="dock-head-actions">
                <button
                  type="button"
                  class="dock-max"
                  :title="dockMax === 'speed' ? strings.dockRestore : strings.dockMaximize"
                  @click.stop="toggleMax('speed')"
                >
                  {{ dockMax === 'speed' ? '⤓' : '⛶' }}
                </button>
                <button type="button" class="dock-fold" :title="strings.noShortcut" @click="toggleDock('speed')">
                  ▾
                </button>
              </div>
            </header>
            <div class="dock-body speed-body">
              <button type="button" class="tb-btn full" :disabled="speedRunning" @click="onRunSpeed">
                {{ speedRunning ? strings.speedTesting : strings.speedTest }}
              </button>
              <p class="muted small">{{ strings.speedUploadNote }}</p>
              <table class="speed-table" aria-label="Regional speed">
                <thead>
                  <tr>
                    <th>{{ strings.speedColRegion }}</th>
                    <th>{{ strings.speedColDown }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in regions" :key="r.id">
                    <td>{{ r.label }}</td>
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
            v-show="dockPanel.chunks && (!dockMax || dockMax === 'chunks')"
            class="dock-card"
            :class="{ 'dock-card-max': dockMax === 'chunks' }"
          >
            <header class="dock-head">
              <span>{{ strings.winDockChunks }}</span>
              <div class="dock-head-actions">
                <button
                  type="button"
                  class="dock-max"
                  :title="dockMax === 'chunks' ? strings.dockRestore : strings.dockMaximize"
                  @click.stop="toggleMax('chunks')"
                >
                  {{ dockMax === 'chunks' ? '⤓' : '⛶' }}
                </button>
                <button type="button" class="dock-fold" :title="strings.noShortcut" @click="toggleDock('chunks')">
                  ▾
                </button>
              </div>
            </header>
            <div class="dock-body">
              <p class="muted small">{{ strings.chunkHint }}</p>
              <div v-if="selectedTask" class="chunk-legend">
                <span class="lg chunk-done">{{ strings.chunkLegendDone }}</span>
                <span class="lg chunk-active">{{ strings.chunkLegendActive }}</span>
                <span class="lg chunk-pending">{{ strings.chunkLegendPending }}</span>
              </div>
              <div v-if="selectedTask" class="chunk-grid">
                <div
                  v-for="(st, i) in selectedTask.chunkSlots"
                  :key="i"
                  class="chunk-cell"
                  :class="chunkClass(st)"
                  :title="`${i + 1}/${selectedTask.chunkSlots.length}`"
                />
              </div>
              <p v-else class="muted">{{ strings.dockNoSelection }}</p>
            </div>
          </section>
        </div>

        <div id="dock-button-bar" class="dock-button-bar" role="toolbar" aria-label="Dock">
          <button
            type="button"
            class="dock-btn"
            :class="{ active: dockPanel.info }"
            :title="strings.winDockInfo"
            @click="toggleDock('info')"
          >
            ℹ
          </button>
          <button
            type="button"
            class="dock-btn"
            :class="{ active: dockPanel.speed }"
            :title="strings.winDockSpeed"
            @click="toggleDock('speed')"
          >
            ⚡
          </button>
          <button
            type="button"
            class="dock-btn"
            :class="{ active: dockPanel.chunks }"
            :title="strings.winDockChunks"
            @click="toggleDock('chunks')"
          >
            ▦
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
      {{ statusSummary }}
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

    <div v-if="pageModalOpen" class="modal-backdrop" @click.self="pageModalOpen = false">
      <div class="modal page-modal" role="dialog" aria-labelledby="page-h">
        <header class="modal-head">
          <h2 id="page-h">{{ strings.pageImportTitle }}</h2>
          <button type="button" class="icon-btn" @click="pageModalOpen = false">{{ strings.logClose }}</button>
        </header>
        <div class="page-body">
          <p class="muted small">{{ strings.pageImportHint }}</p>
          <label class="page-label">{{ strings.pageUrlLabel }}</label>
          <input v-model="pageUrl" class="url-input page-url-inp" type="url" />
          <div class="page-actions">
            <button type="button" class="tb-btn" @click="fetchPageLinks">{{ strings.pageFetch }}</button>
            <button type="button" class="tb-btn" @click="choosePageDir">{{ strings.pagePickDir }}</button>
            <button type="button" class="tb-btn" @click="pageSelectAll(true)">{{ strings.pageSelectAll }}</button>
            <button type="button" class="tb-btn" @click="pageSelectAll(false)">{{ strings.pageClear }}</button>
            <button type="button" class="tb-btn" @click="addSelectedFromPage">{{ strings.pageAddSelected }}</button>
          </div>
          <p v-if="pageDirHandle" class="small mono">📁 {{ pageDirHandle.name }}</p>
          <div class="page-link-list">
            <p class="small">{{ strings.pageLinks }} ({{ pageLinks.length }})</p>
            <label v-for="u in pageLinks" :key="u" class="page-link-row">
              <input v-model="pageSelected[u]" type="checkbox" />
              <span class="mono break">{{ u }}</span>
            </label>
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
