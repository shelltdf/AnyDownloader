import { onMounted, onUnmounted, ref, watch } from 'vue'

const CHROME_VISIBLE_KEY = 'any-downloader-electron-chrome'

export function useElectronShell() {
  const isElectron = typeof window !== 'undefined' && !!window.anyDownloaderShell
  const shellVersion = ref('')
  const maximized = ref(false)
  const electronChromeVisible = ref(true)

  let unsubMax: (() => void) | null = null

  onMounted(async () => {
    const s = window.anyDownloaderShell
    if (!s) return
    try {
      const raw = localStorage.getItem(CHROME_VISIBLE_KEY)
      if (raw === '0') electronChromeVisible.value = false
      else if (raw === '1') electronChromeVisible.value = true
    } catch {
      /* ignore */
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

  watch(electronChromeVisible, (v) => {
    if (!isElectron) return
    try {
      localStorage.setItem(CHROME_VISIBLE_KEY, v ? '1' : '0')
    } catch {
      /* ignore */
    }
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

  function toggleElectronChromeFromContextMenu() {
    if (!isElectron) return
    electronChromeVisible.value = !electronChromeVisible.value
  }

  return {
    isElectron,
    shellVersion,
    maximized,
    electronChromeVisible,
    winMinimize,
    winMaximizeToggle,
    winClose,
    toggleElectronChromeFromContextMenu,
  }
}
