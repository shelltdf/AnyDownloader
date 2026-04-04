/**
 * 选择保存位置（File System Access API）。
 * 不支持时返回仅文件名，由完成时 `<a download>` 落盘。
 */
export type SavePickResult = {
  fileName: string
  handle: FileSystemFileHandle | null
  /** Electron：网页导入时由主进程对话框得到，落盘走 IPC 写文件 */
  electronOutputDir?: string | null
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 200) || 'download'
}

/** 相对路径：逐段净化，用于目录句柄嵌套创建与 Electron 写盘 fileName */
export function sanitizeRelativeSavePath(rel: string): string {
  const parts = rel
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => sanitizeFileName(p.trim()))
    .filter((p) => p.length > 0)
  const joined = parts.join('/')
  return joined.length > 500 ? joined.slice(0, 500) : joined || 'download'
}

/**
 * 在已授权目录下按相对路径创建子目录并创建文件句柄（File System Access API）。
 */
export async function getOrCreateFileHandleInDirectory(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<FileSystemFileHandle> {
  const parts = relativePath
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
  if (!parts.length) throw new Error('empty path')
  const safe = parts.map((p) => sanitizeFileName(p))
  const fileName = safe.pop()!
  let dir = root
  for (const seg of safe) {
    dir = await dir.getDirectoryHandle(seg, { create: true })
  }
  return dir.getFileHandle(fileName, { create: true })
}

type SavePickerFn = (options?: {
  suggestedName?: string
  types?: Array<{ description: string; accept: Record<string, string[]> }>
}) => Promise<FileSystemFileHandle>

export async function pickSaveLocation(suggestedName: string): Promise<SavePickResult | null> {
  const name = sanitizeFileName(suggestedName)
  const picker = (globalThis as unknown as { showSaveFilePicker?: SavePickerFn }).showSaveFilePicker
  if (typeof picker === 'function') {
    try {
      // 勿在 accept 中使用非法扩展名（如 ".*"），会抛 TypeError；省略 types 即不限制类型
      const handle = await picker({ suggestedName: name })
      return { fileName: handle.name, handle }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null
      // 嵌入式浏览器 / 扩展环境可能抛错，回退为输入文件名，避免未捕获 Promise
      console.warn('showSaveFilePicker failed, using filename prompt:', e)
      const entered = window.prompt('Save as file name:', name)
      if (entered == null || !entered.trim()) return null
      return { fileName: sanitizeFileName(entered.trim()), handle: null }
    }
  }
  const entered = window.prompt('Save as file name:', name)
  if (entered == null || !entered.trim()) return null
  return { fileName: sanitizeFileName(entered.trim()), handle: null }
}

export async function pickSaveDirectory(): Promise<FileSystemDirectoryHandle | null> {
  const dirPicker = (globalThis as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> })
    .showDirectoryPicker
  if (typeof dirPicker !== 'function') return null
  try {
    return await dirPicker()
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null
    throw e
  }
}
