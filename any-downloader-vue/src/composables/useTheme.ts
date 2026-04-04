import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useLog } from './useLog'
import { tMsg } from './useI18n'

export type ThemeMode = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'any-downloader-theme'

export const themeMode = ref<ThemeMode>('system')

function readStored(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY) as ThemeMode | null
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* ignore */
  }
  return 'system'
}

export function applyDomTheme(m: ThemeMode) {
  const root = document.documentElement
  root.removeAttribute('data-theme')
  if (m === 'light') {
    root.setAttribute('data-theme', 'light')
  } else if (m === 'dark') {
    root.setAttribute('data-theme', 'dark')
  }
}

export function applyStoredThemeOnBoot() {
  themeMode.value = readStored()
  applyDomTheme(themeMode.value)
}

let themeEffectsInstalled = false

export function useTheme() {
  const { notify } = useLog()

  function setMode(m: ThemeMode) {
    themeMode.value = m
    applyDomTheme(m)
  }

  onMounted(() => {
    if (themeEffectsInstalled) return
    themeEffectsInstalled = true

    const stop = watch(themeMode, (m) => {
      try {
        localStorage.setItem(STORAGE_KEY, m)
      } catch {
        notify('warn', tMsg('errThemePersist'))
      }
      applyDomTheme(m)
    })

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onScheme = () => {
      if (themeMode.value === 'system') applyDomTheme('system')
    }
    mq.addEventListener('change', onScheme)

    onUnmounted(() => {
      stop()
      mq.removeEventListener('change', onScheme)
      themeEffectsInstalled = false
    })
  })

  return { mode: themeMode, setMode }
}
