/** 断点续传：分片元数据与已完成分片字节（IndexedDB） */

const DB_NAME = 'any-downloader-resume-v1'
const STORE = 'partials'
const DB_VER = 1

export interface PersistedPart {
  start: number
  end: number
  /** 已完成区间 [0, end-start] 内已写入长度 */
  filled: number
  /** 已下载的字节（与 filled 一致时该分片完成） */
  data: ArrayBuffer
}

export interface PersistedHttpTask {
  id: string
  href: string
  totalBytes: number
  partCount: number
  parts: PersistedPart[]
  updatedAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
  })
}

export async function idbSavePartial(row: PersistedHttpTask): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(STORE).put({ ...row, updatedAt: Date.now() })
  })
}

export async function idbLoadPartial(id: string): Promise<PersistedHttpTask | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(id)
    req.onsuccess = () => resolve((req.result as PersistedHttpTask | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function idbDeletePartial(id: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(STORE).delete(id)
  })
}
