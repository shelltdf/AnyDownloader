import { onMounted, onUnmounted, ref } from 'vue'

export function useElectronShell() {
  const isElectron = typeof window !== 'undefined' && !!window.anyDownloaderShell
  const shellVersion = ref('')
  const maximized = ref(false)
  /** 主进程：是否使用系统原生标题栏 + 顶层应用菜单（与页内菜单/工具栏无关） */
  const useNativeOsChrome = ref(false)

  let unsubMax: (() => void) | null = null

  onMounted(async () => {
    const s = window.anyDownloaderShell
    if (!s) return
    try {
      const r = await s.getUseNativeChrome?.()
      if (r && typeof r.useNativeChrome === 'boolean') {
        useNativeOsChrome.value = r.useNativeChrome
      }
    } catch {
      /* 旧 preload 无此 API */
    }
    try {
      shellVersion.value = (await s.getVersion()) || ''
    } catch {
      shellVersion.value = ''
    }
    unsubMax = s.onMaximizedChange((v) => {
      maximized.value = v
    })
  })

  onUnmounted(() => {
    unsubMax?.()
    unsubMax = null
  })

  function winMinimize() {
    window.anyDownloaderShell?.windowAction('minimize')
  }

  function winMaximizeToggle() {
    window.anyDownloaderShell?.windowAction('maximize-toggle')
  }

  function winClose() {
    window.anyDownloaderShell?.windowAction('close')
  }

  return {
    isElectron,
    shellVersion,
    maximized,
    useNativeOsChrome,
    winMinimize,
    winMaximizeToggle,
    winClose,
  }
}
