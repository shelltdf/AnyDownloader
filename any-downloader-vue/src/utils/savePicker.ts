/**
 * 选择保存位置（File System Access API）。
 * 不支持时返回仅文件名，由完成时 `<a download>` 落盘。
 */
export type SavePickResult = { fileName: string; handle: FileSystemFileHandle | null }

function sanitizeFileName(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 200) || 'download'
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
