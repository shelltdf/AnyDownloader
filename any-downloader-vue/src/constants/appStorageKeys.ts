/** 本应用使用的 localStorage 键（用于展示与批量清理，请勿随意改名以免丢用户数据） */
export const APP_STORAGE_KEYS = {
  TASK_LIST: 'any-downloader-task-list-v1',
  THEME: 'any-downloader-theme',
  THREAD_MODE: 'any-downloader-thread-mode',
  THREAD_MANUAL: 'any-downloader-thread-manual',
  CONCURRENCY_MODE: 'any-downloader-concurrency-mode',
  CONCURRENCY_MAX: 'any-downloader-concurrency-max',
  PRESSURE: 'any-downloader-pressure',
  PAGE_IMPORT_DIR: 'any-downloader-page-import-dir',
} as const

export type AppStorageKey = (typeof APP_STORAGE_KEYS)[keyof typeof APP_STORAGE_KEYS]
