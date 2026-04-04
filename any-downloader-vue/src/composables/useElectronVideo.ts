import { onUnmounted, ref, watch } from 'vue'

const LOG_CAP = 250_000

/** 与 `electron/video-ytdlp.cjs` 中 `buildYtDlpFormatArgs` 白名单一致 */
export type VideoYtdlpFormatPreset =
  | 'default'
  | 'best'
  | '2160'
  | '1440'
  | '1080'
  | '720'
  | '480'
  | 'audio'
  | 'worst'

export function useElectronVideo() {
  const videoModalOpen = ref(false)
  const videoUrl = ref('')
  const videoOutDir = ref<string | null>(null)
  const videoLog = ref('')
  const videoRunning = ref(false)
  const videoFormatPreset = ref<VideoYtdlpFormatPreset>('best')
  const videoEmbedSubs = ref(false)
  const ytdlpAvailable = ref<boolean | null>(null)
  const ytdlpVia = ref('')

  let unsubLog: (() => void) | null = null

  function detachLog() {
    unsubLog?.()
    unsubLog = null
  }

  function attachLog() {
    detachLog()
    const shell = window.anyDownloaderShell
    if (!shell?.onVideoYtdlpLog) return
    unsubLog = shell.onVideoYtdlpLog((data) => {
      const chunk = data?.chunk != null ? String(data.chunk) : ''
      if (!chunk) return
      videoLog.value += chunk
      if (videoLog.value.length > LOG_CAP) {
        videoLog.value = videoLog.value.slice(-Math.floor(LOG_CAP * 0.8))
      }
    })
  }

  async function probeYtdlp(force: boolean) {
    const shell = window.anyDownloaderShell
    if (!shell?.checkYtdlp) {
      ytdlpAvailable.value = false
      return
    }
    try {
      const r = await shell.checkYtdlp(force)
      ytdlpAvailable.value = Boolean(r?.available)
      ytdlpVia.value = (r?.via && String(r.via)) || ''
    } catch {
      ytdlpAvailable.value = false
      ytdlpVia.value = ''
    }
  }

  watch(videoModalOpen, (open) => {
    if (!open) {
      detachLog()
      return
    }
    videoLog.value = ''
    attachLog()
    void probeYtdlp(false)
  })

  onUnmounted(() => {
    detachLog()
  })

  function openVideoDownloadModal() {
    if (!window.anyDownloaderShell) return
    videoModalOpen.value = true
  }

  function closeVideoDownloadModal() {
    videoModalOpen.value = false
  }

  async function recheckYtdlp() {
    await probeYtdlp(true)
  }

  async function pickVideoDir() {
    const shell = window.anyDownloaderShell
    if (!shell?.pickVideoOutputDir) return
    const p = await shell.pickVideoOutputDir()
    videoOutDir.value = p
  }

  async function cancelVideoDownload() {
    try {
      await window.anyDownloaderShell?.cancelVideoDownload?.()
    } catch {
      /* ignore */
    }
    videoRunning.value = false
  }

  async function startVideoDownload(
    messages: {
      errInvalidUrl: string
      errVideoNoDir: string
      errVideoNoYtdlp: string
      errVideoFailed: string
      notifyVideoDone: string
      notifyVideoCancelled: string
    },
    notify: (level: 'info' | 'warn' | 'error', msg: string) => void,
  ) {
    const shell = window.anyDownloaderShell
    if (!shell?.startVideoDownload) return
    const url = videoUrl.value.trim()
    const outputDir = (videoOutDir.value || '').trim()
    if (!url) {
      notify('warn', messages.errInvalidUrl)
      return
    }
    try {
      const u = new URL(url)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        notify('warn', messages.errInvalidUrl)
        return
      }
    } catch {
      notify('warn', messages.errInvalidUrl)
      return
    }
    if (!outputDir) {
      notify('warn', messages.errVideoNoDir)
      return
    }
    if (ytdlpAvailable.value === false) {
      notify('error', messages.errVideoNoYtdlp)
      return
    }
    videoRunning.value = true
    videoLog.value = ''
    try {
      const r = await shell.startVideoDownload({
        url,
        outputDir,
        formatPreset: videoFormatPreset.value,
        embedSubs: videoEmbedSubs.value,
      })
      if (r && 'cancelled' in r && r.cancelled) {
        notify('info', messages.notifyVideoCancelled)
      } else if (r && 'ok' in r && r.ok) {
        notify('info', messages.notifyVideoDone)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      notify('error', `${messages.errVideoFailed}: ${msg}`)
    } finally {
      videoRunning.value = false
    }
  }

  return {
    videoModalOpen,
    videoUrl,
    videoOutDir,
    videoLog,
    videoRunning,
    videoFormatPreset,
    videoEmbedSubs,
    ytdlpAvailable,
    ytdlpVia,
    openVideoDownloadModal,
    closeVideoDownloadModal,
    recheckYtdlp,
    pickVideoDir,
    cancelVideoDownload,
    startVideoDownload,
  }
}
