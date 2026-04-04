import { ref } from 'vue'
import { parseTorrentFileBuffer, type ParsedTorrentMeta } from '../utils/parseTorrentMeta'

/** 从绝对路径取所在目录（与 Node path.dirname 等效，不引入 path 包） */
function dirnameFromFilePath(filePath: string): string | null {
  const s = filePath.trim()
  if (!s) return null
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  if (i <= 0) return null
  return s.slice(0, i)
}

export function useBtTorrentModal() {
  const btTorrentModalOpen = ref(false)
  const btParsed = ref<ParsedTorrentMeta | null>(null)
  const btParseError = ref<string | null>(null)
  const btTorrentHref = ref<string | null>(null)
  const btTorrentPathLabel = ref('')
  const btOutputDir = ref<string | null>(null)
  const btBusy = ref(false)

  function resetBtTorrentForm() {
    btParsed.value = null
    btParseError.value = null
    btTorrentHref.value = null
    btTorrentPathLabel.value = ''
    btOutputDir.value = null
  }

  function openBtTorrentModal() {
    if (typeof window === 'undefined' || !window.anyDownloaderShell?.pickTorrentFile) return
    resetBtTorrentForm()
    btTorrentModalOpen.value = true
  }

  function closeBtTorrentModal() {
    btTorrentModalOpen.value = false
    resetBtTorrentForm()
  }

  async function pickBtTorrentFile() {
    const shell = window.anyDownloaderShell
    if (!shell?.pickTorrentFile) return
    btBusy.value = true
    btParseError.value = null
    btParsed.value = null
    try {
      const r = await shell.pickTorrentFile()
      if (!r?.data || !r.href) {
        btTorrentHref.value = null
        btTorrentPathLabel.value = ''
        return
      }
      btTorrentPathLabel.value = r.path ? r.path.split(/[/\\]/).pop() || r.path : ''
      btTorrentHref.value = r.href
      if (r.path) {
        const dir = dirnameFromFilePath(r.path)
        if (dir) btOutputDir.value = dir
      }
      const meta = await parseTorrentFileBuffer(r.data)
      btParsed.value = meta
    } catch (e) {
      btTorrentHref.value = null
      btTorrentPathLabel.value = ''
      btParsed.value = null
      btParseError.value = (e as Error).message || String(e)
    } finally {
      btBusy.value = false
    }
  }

  async function pickBtTorrentOutputDir() {
    const shell = window.anyDownloaderShell
    if (!shell?.pickImportDirectory) return
    try {
      const picked = await shell.pickImportDirectory()
      btOutputDir.value = picked?.path?.trim() || null
    } catch {
      btOutputDir.value = null
    }
  }

  return {
    btTorrentModalOpen,
    btParsed,
    btParseError,
    btTorrentHref,
    btTorrentPathLabel,
    btOutputDir,
    btBusy,
    openBtTorrentModal,
    closeBtTorrentModal,
    pickBtTorrentFile,
    pickBtTorrentOutputDir,
    resetBtTorrentForm,
  }
}
