/// <reference types="vite/client" />

export {}

declare global {
  const __APP_VERSION__: string

  interface Window {
    anyDownloaderShell?: {
      isElectron: true
      getVersion: () => Promise<string>
      checkYtdlp: (force?: boolean) => Promise<{ available: boolean; via?: string }>
      pickVideoOutputDir: () => Promise<string | null>
      startVideoDownload: (payload: {
        url: string
        outputDir: string
        formatPreset?: string
        embedSubs?: boolean
      }) => Promise<{ ok: true } | { ok: false; cancelled: true }>
      cancelVideoDownload: () => Promise<{ ok: boolean }>
      onVideoYtdlpLog: (callback: (data: { chunk: string }) => void) => () => void
      windowAction: (action: 'minimize' | 'maximize-toggle' | 'close') => void
      onMaximizedChange: (callback: (maximized: boolean) => void) => () => void
      getUseNativeChrome: () => Promise<{ useNativeChrome: boolean }>
      setUseNativeChrome: (value: boolean) => Promise<{ ok: boolean }>
      popupShellChromeMenu: (payload: {
        clientX: number
        clientY: number
        labels?: { nativeChrome?: string }
      }) => Promise<void>
      pickImportDirectory?: () => Promise<{ path: string } | null>
      pickTorrentFile?: () => Promise<{ path: string; href: string; data: ArrayBuffer } | null>
      writeImportFile?: (opts: {
        dirPath: string
        fileName: string
        data: ArrayBuffer
        /** 默认 true：先写 .part 再 rename */
        atomic?: boolean
      }) => Promise<{ ok: boolean }>
      checkAria2?: (force?: boolean) => Promise<{ available: boolean; via?: string }>
      startAria2Job?: (payload: {
        outputDir: string
        magnetUri?: string
        torrentFileUrl?: string
      }) => Promise<{ ok: true } | { ok: false; cancelled: true }>
      cancelAria2Job?: () => Promise<{ ok: boolean }>
      onAria2Log?: (callback: (data: { chunk: string }) => void) => () => void
    }
  }
}
