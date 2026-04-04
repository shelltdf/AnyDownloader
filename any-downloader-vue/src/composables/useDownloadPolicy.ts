import { ref, watch } from 'vue'
import { APP_STORAGE_KEYS } from '../constants/appStorageKeys'

const STORAGE_MODE = APP_STORAGE_KEYS.CONCURRENCY_MODE
const STORAGE_MAX = APP_STORAGE_KEYS.CONCURRENCY_MAX
const STORAGE_PRESSURE = APP_STORAGE_KEYS.PRESSURE

export type TaskConcurrencyMode = 'auto' | 'manual'
export type PressureStrategy = 'min' | 'balanced' | 'max'

export const taskConcurrencyMode = ref<TaskConcurrencyMode>('manual')
/** 手动模式下的并行任务上限，或自动模式下的「探索上限」参考，默认 2 */
export const maxConcurrentTasksManual = ref(2)
export const pressureStrategy = ref<PressureStrategy>('balanced')

function loadPolicy() {
  try {
    const m = localStorage.getItem(STORAGE_MODE) as TaskConcurrencyMode | null
    if (m === 'auto' || m === 'manual') taskConcurrencyMode.value = m
    const n = Number(localStorage.getItem(STORAGE_MAX))
    if (Number.isFinite(n) && n >= 1 && n <= 16) maxConcurrentTasksManual.value = Math.floor(n)
    const p = localStorage.getItem(STORAGE_PRESSURE) as PressureStrategy | null
    if (p === 'min' || p === 'balanced' || p === 'max') pressureStrategy.value = p
  } catch {
    /* ignore */
  }
}

loadPolicy()

/** 从 localStorage 重新加载（在用户单独清除某项后调用） */
export function reloadPolicyFromStorage() {
  loadPolicy()
}

watch([taskConcurrencyMode, maxConcurrentTasksManual, pressureStrategy], () => {
  try {
    localStorage.setItem(STORAGE_MODE, taskConcurrencyMode.value)
    localStorage.setItem(STORAGE_MAX, String(maxConcurrentTasksManual.value))
    localStorage.setItem(STORAGE_PRESSURE, pressureStrategy.value)
  } catch {
    /* ignore */
  }
})

/** 用户配置的并行任务上限（1–16）；自动模式下为「探索上限」 */
function userConcurrencyCap(): number {
  return Math.min(16, Math.max(1, Math.floor(maxConcurrentTasksManual.value)))
}

/**
 * 当前允许同时处于 running 的下载任务数。
 * - 手动：等于用户设置的上限。
 * - 自动：按压力策略与 hardwareConcurrency 估算，且不超过用户设置的「探索上限」（默认 2）。
 */
export function effectiveMaxConcurrentTasks(): number {
  const cap = userConcurrencyCap()
  if (taskConcurrencyMode.value === 'manual') return cap

  const cores = typeof navigator !== 'undefined' ? Math.max(2, navigator.hardwareConcurrency || 4) : 4
  let discovered: number
  switch (pressureStrategy.value) {
    case 'min':
      discovered = 1
      break
    case 'balanced':
      discovered = Math.min(4, Math.max(1, Math.round(cores / 4) + 1))
      break
    case 'max':
      discovered = Math.min(12, Math.max(2, cores - 1))
      break
    default:
      discovered = 2
  }
  return Math.min(cap, discovered)
}

/**
 * 每任务 HTTP 连接数的乘数（相对 useDownloadThreads 的基准）。
 * 最小：少连接、少抢占；最大：略增连接（仍封顶 16），在留足系统余量的前提下提高吞吐。
 */
export function pressureConnectionMultiplier(): number {
  switch (pressureStrategy.value) {
    case 'min':
      return 0.45
    case 'balanced':
      return 1
    case 'max':
      return 1.35
    default:
      return 1
  }
}

export function useDownloadPolicy() {
  return {
    taskConcurrencyMode,
    maxConcurrentTasksManual,
    pressureStrategy,
    effectiveMaxConcurrentTasks,
    pressureConnectionMultiplier,
  }
}
