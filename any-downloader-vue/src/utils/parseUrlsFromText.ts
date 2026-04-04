import { expandLegacyDownloadLink } from './protocol'

const URL_LINE_RE =
  /https?:\/\/[^\s"'<>\][(){}]+|magnet:\?[^\s"'<>\][()]+|thunder:\/\/[^\s"'<>\][()]+|flashget:\/\/[^\s"'<>\][()]+|qqdl:\/\/[^\s"'<>\][()]+/gi

/** 将一段文本中的下载相关 URL 并入集合（用于流式按行/按块解析） */
export function addUrlsFromTextFragment(fragment: string, set: Set<string>): void {
  const body = fragment || ''

  URL_LINE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = URL_LINE_RE.exec(body))) {
    let s = m[0].replace(/[,;.)}\]]+$/g, '')
    s = expandLegacyDownloadLink(s.trim())
    if (s.length > 8 && s.length < 8192) set.add(s)
  }

  for (const line of body.split(/\r?\n/)) {
    const ln = expandLegacyDownloadLink(line.trim())
    if (!ln) continue
    const head = ln.split(/\s+/)[0]
    if (
      /^https?:\/\//i.test(head) ||
      /^magnet:/i.test(head) ||
      /^thunder:/i.test(head) ||
      /^flashget:/i.test(head) ||
      /^qqdl:/i.test(head)
    ) {
      if (head.length > 8) set.add(head)
    }
  }
}

/** 从任意文本中提取可识别的下载相关 URL（去重） */
export function extractUrlsFromText(text: string): string[] {
  const set = new Set<string>()
  addUrlsFromTextFragment(text, set)
  return [...set].sort((a, b) => a.localeCompare(b))
}
