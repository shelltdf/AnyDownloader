import { computed, ref, watch } from 'vue'

const STORAGE_KEY = 'any-downloader-thread-mode'
const STORAGE_MANUAL = 'any-downloader-thread-manual'

export type ThreadMode = 'auto' | 'manual'

const mode = ref<ThreadMode>('auto')
const manualCount = ref(6)

function load() {
  try {
    const m = localStorage.getItem(STORAGE_KEY) as ThreadMode | null
    if (m === 'auto' || m === 'manual') mode.value = m
    const n = Number(localStorage.getItem(STORAGE_MANUAL))
    if (Number.isFinite(n) && n >= 1 && n <= 16) manualCount.value = Math.floor(n)
  } catch {
    /* ignore */
  }
}

load()

watch([mode, manualCount], () => {
  try {
    localStorage.setItem(STORAGE_KEY, mode.value)
    localStorage.setItem(STORAGE_MANUAL, String(manualCount.value))
  } catch {
    /* ignore */
  }
})

/** 自动：按已知大小估算连接数（1–16） */
export function autoThreadCount(totalBytes: number | null): number {
  if (totalBytes == null || !Number.isFinite(totalBytes) || totalBytes <= 0) return 4
  if (totalBytes < 512 * 1024) return 2
  if (totalBytes < 5 * 1024 * 1024) return 4
  if (totalBytes < 50 * 1024 * 1024) return 6
  if (totalBytes < 200 * 1024 * 1024) return 8
  return 10
}

export function useDownloadThreads() {
  const modeLabel = computed(() =>
    mode.value === 'auto'
      ? 'auto'
      : `manual:${manualCount.value}`,
  )

  function effectiveThreadCount(totalBytes: number | null, taskOverride: number | null): number {
    if (taskOverride != null && Number.isFinite(taskOverride)) {
      const n = Math.min(16, Math.max(1, Math.floor(taskOverride)))
      return n
    }
    if (mode.value === 'manual') {
      return Math.min(16, Math.max(1, manualCount.value))
    }
    return autoThreadCount(totalBytes)
  }

  return {
    mode,
    manualCount,
    modeLabel,
    effectiveThreadCount,
    autoThreadCount,
  }
}
