/**
 * 多 HTTP(S) 链接批量保存时，按「公共目录前缀」推导相对路径（需同 origin）。
 */

function longestCommonDirPathPrefix(pathnames: string[]): string {
  if (pathnames.length === 0) return '/'
  const first = pathnames[0]
  let len = 0
  for (let i = 0; i < first.length; i++) {
    const ch = first[i]
    if (!pathnames.every((p) => p[i] === ch)) break
    len = i + 1
  }
  let prefix = first.slice(0, len)
  const lastSlash = prefix.lastIndexOf('/')
  if (lastSlash < 0) return '/'
  return prefix.slice(0, lastSlash + 1)
}

/** 若少于 2 个合法同站 URL，返回 null */
export function computeHttpBatchDirPrefix(urls: string[]): string | null {
  const parsed: URL[] = []
  for (const u of urls) {
    try {
      const x = new URL(u.trim())
      if (x.protocol !== 'http:' && x.protocol !== 'https:') return null
      parsed.push(x)
    } catch {
      return null
    }
  }
  if (parsed.length < 2) return null
  const origin = parsed[0].origin
  if (!parsed.every((u) => u.origin === origin)) return null
  const prefixPath = longestCommonDirPathPrefix(parsed.map((u) => u.pathname))
  return `${origin}${prefixPath}`
}

function basenameFromPathname(pathname: string): string {
  const seg = pathname.split('/').filter(Boolean).pop()
  if (!seg) return 'download'
  try {
    return decodeURIComponent(seg.split('?')[0] || seg)
  } catch {
    return seg
  }
}

/**
 * 在已知「目录前缀」完整 URL（含 path，通常以 / 结尾）下，返回相对路径（含文件名），用 / 分隔。
 */
export function relativeFilePathUnderUrlPrefix(fullUrl: string, dirPrefixUrl: string): string {
  let u: URL
  let base: URL
  try {
    u = new URL(fullUrl.trim())
    base = new URL(dirPrefixUrl.trim())
  } catch {
    return 'download'
  }
  if (u.origin !== base.origin) return basenameFromPathname(u.pathname)
  if (!u.pathname.startsWith(base.pathname)) return basenameFromPathname(u.pathname)
  let rel = u.pathname.slice(base.pathname.length).replace(/^\/+/, '')
  if (!rel) return basenameFromPathname(u.pathname)
  return rel
    .split('/')
    .map((seg) => {
      try {
        return decodeURIComponent(seg)
      } catch {
        return seg
      }
    })
    .join('/')
}
