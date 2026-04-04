import { APP_STORAGE_KEYS, type AppStorageKey } from '../constants/appStorageKeys'

export interface LocalStorageRow {
  key: AppStorageKey
  bytes: number
  charLength: number
}

function byteLength(s: string): number {
  try {
    return new Blob([s]).size
  } catch {
    return s.length * 2
  }
}

export function listAppLocalStorageRows(): LocalStorageRow[] {
  if (typeof localStorage === 'undefined') return []
  const rows: LocalStorageRow[] = []
  for (const key of Object.values(APP_STORAGE_KEYS)) {
    const raw = localStorage.getItem(key)
    const s = raw ?? ''
    rows.push({ key, bytes: byteLength(s), charLength: s.length })
  }
  return rows
}

export function clearAppLocalStorageKey(key: AppStorageKey): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

/** 删除所有应用已知的 localStorage 项（主题、任务列表、策略等） */
export function clearAllKnownAppLocalStorage(): void {
  for (const key of Object.values(APP_STORAGE_KEYS)) {
    clearAppLocalStorageKey(key)
  }
}
