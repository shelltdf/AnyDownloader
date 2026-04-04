import { addUrlsFromTextFragment } from './parseUrlsFromText'

export interface StreamExtractUrlsOptions {
  signal?: AbortSignal
  onProgress?: (loadedBytes: number, totalBytes: number) => void
  /** 每处理这么多完整行就让出主线程，避免大文件卡死界面 */
  yieldEveryLines?: number
}

const DEFAULT_YIELD_LINES = 800

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

/**
 * 流式读取文本文件并按行提取 URL，避免将整文件一次性读入内存。
 * 优先使用 Blob.stream()；不支持时按块 slice + arrayBuffer 回退。
 */
export async function extractUrlsFromFileStream(
  file: File,
  options: StreamExtractUrlsOptions = {},
): Promise<{ urls: string[]; bytesRead: number; aborted: boolean }> {
  const set = new Set<string>()
  const yieldEvery = options.yieldEveryLines ?? DEFAULT_YIELD_LINES
  let bytesRead = 0
  let lineSinceYield = 0
  let aborted = false
  const onProgress = options.onProgress
  const total = file.size

  const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0))

  const processLine = async (line: string): Promise<void> => {
    addUrlsFromTextFragment(line + '\n', set)
    lineSinceYield++
    if (lineSinceYield >= yieldEvery) {
      lineSinceYield = 0
      await yieldToUi()
    }
  }

  const splitLinesAndDrain = async (carryIn: string): Promise<string> => {
    let carry = carryIn
    const parts = carry.split(/\r?\n/)
    carry = parts.pop() ?? ''
    for (const line of parts) {
      if (options.signal?.aborted) {
        aborted = true
        return carry
      }
      await processLine(line)
    }
    return carry
  }

  try {
    if (typeof file.stream === 'function') {
      const reader = file.stream().getReader()
      const decoder = new TextDecoder('utf-8', { fatal: false })
      let carry = ''
      let first = true
      while (!aborted) {
        if (options.signal?.aborted) {
          aborted = true
          await reader.cancel().catch(() => {})
          break
        }
        const { done, value } = await reader.read()
        if (done) {
          carry += decoder.decode()
          break
        }
        bytesRead += value.byteLength
        onProgress?.(bytesRead, total)
        let chunk = decoder.decode(value, { stream: true })
        if (first) {
          chunk = stripBom(chunk)
          first = false
        }
        carry += chunk
        carry = await splitLinesAndDrain(carry)
      }
      if (!aborted && carry.length > 0) {
        carry = stripBom(carry)
        addUrlsFromTextFragment(carry, set)
      }
    } else {
      const CHUNK = Math.min(4 * 1024 * 1024, Math.max(file.size, 1))
      const decoder = new TextDecoder('utf-8', { fatal: false })
      let carry = ''
      let first = true
      for (let off = 0; off < file.size && !aborted; off += CHUNK) {
        if (options.signal?.aborted) {
          aborted = true
          break
        }
        const end = Math.min(off + CHUNK, file.size)
        const buf = await file.slice(off, end).arrayBuffer()
        bytesRead = end
        onProgress?.(bytesRead, total)
        let chunk = decoder.decode(buf, { stream: end < file.size })
        if (first) {
          chunk = stripBom(chunk)
          first = false
        }
        carry += chunk
        carry = await splitLinesAndDrain(carry)
      }
      if (!aborted && carry.length > 0) {
        addUrlsFromTextFragment(carry, set)
      }
    }
  } catch (e) {
    const err = e as Error
    if (err.name === 'AbortError') aborted = true
    else throw e
  }

  const urls = [...set].sort((a, b) => a.localeCompare(b))
  return { urls, bytesRead, aborted }
}
