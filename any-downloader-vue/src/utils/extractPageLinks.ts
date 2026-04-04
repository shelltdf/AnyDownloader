/** 从网页 HTML 提取链接（需目标页允许 CORS）；含直链、静态资源、音视频与常见流媒体清单 */

export type PageResourceKind =
  | 'http_link'
  | 'static_asset'
  | 'video_src'
  | 'audio_src'
  | 'hls'
  | 'dash'
  | 'embed_page'
  | 'other'

export interface RichPageLink {
  url: string
  kind: PageResourceKind
  /** 适合用本应用 HTTP(S) 流程尝试下载（非 HLS/DASH 整包、非纯嵌入站） */
  canTryHttpDownload: boolean
}

const KIND_RANK: Record<PageResourceKind, number> = {
  hls: 80,
  dash: 75,
  video_src: 65,
  audio_src: 65,
  embed_page: 50,
  static_asset: 45,
  http_link: 35,
  other: 20,
}

function isEmbedHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase()
    return /(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)vimeo\.com$|(^|\.)bilibili\.com$|(^|\.)twitch\.tv$|(^|\.)dailymotion\.com$|(^|\.)facebook\.com$|(^|\.)tiktok\.com$/i.test(
      h,
    )
  } catch {
    return false
  }
}

/** 根据 URL 路径/主机判断资源类型与是否适合浏览器内直链下载 */
export function classifyDownloadUrl(url: string): Pick<RichPageLink, 'kind' | 'canTryHttpDownload'> {
  if (isEmbedHost(url)) {
    return { kind: 'embed_page', canTryHttpDownload: false }
  }
  const L = url.toLowerCase().split(/[#?]/)[0] || url.toLowerCase()
  if (/\.m3u8$/i.test(L)) return { kind: 'hls', canTryHttpDownload: false }
  if (/\.mpd$/i.test(L)) return { kind: 'dash', canTryHttpDownload: false }
  if (/\.(mp4|webm|ogv|mov|mkv|m4v)(\?|$)/i.test(url))
    return { kind: 'video_src', canTryHttpDownload: true }
  if (/\.(mp3|wav|ogg|m4a|flac|aac|opus)(\?|$)/i.test(url))
    return { kind: 'audio_src', canTryHttpDownload: true }
  if (/\.(png|jpe?g|gif|webp|svg|ico|bmp|css|js|mjs|json|xml|txt|wasm|woff2?|ttf|eot|zip|rar|7z|gz|pdf|docx?|xlsx?)(\?|$)/i.test(url))
    return { kind: 'static_asset', canTryHttpDownload: true }
  return { kind: 'http_link', canTryHttpDownload: true }
}

function absUrl(base: string, href: string | null | undefined): string | null {
  if (!href || !href.trim()) return null
  const t = href.trim()
  if (/^https?:\/\//i.test(t)) return t
  if (t.startsWith('//')) return `https:${t}`
  try {
    return new URL(t, base).href
  } catch {
    return null
  }
}

function mergeLink(map: Map<string, RichPageLink>, url: string | null, preferredKind?: PageResourceKind) {
  if (!url || !/^https?:\/\//i.test(url)) return
  const inferred = classifyDownloadUrl(url)
  const kind = preferredKind ?? inferred.kind
  const canTryHttpDownload = kind !== 'hls' && kind !== 'dash' && kind !== 'embed_page'
  const prev = map.get(url)
  const rank = KIND_RANK[kind]
  if (!prev || rank >= KIND_RANK[prev.kind]) {
    map.set(url, { url, kind, canTryHttpDownload })
  }
}

/** 从 HTML 字符串提取富链接列表（baseUrl 用于相对路径解析） */
export function extractRichLinksFromHtml(html: string, pageUrl: string): RichPageLink[] {
  const base = pageUrl.trim()
  const map = new Map<string, RichPageLink>()
  const doc = new DOMParser().parseFromString(html, 'text/html')

  doc.querySelectorAll('a[href]').forEach((a) => {
    mergeLink(map, absUrl(base, a.getAttribute('href')))
  })
  doc.querySelectorAll('link[href]').forEach((l) => {
    mergeLink(map, absUrl(base, l.getAttribute('href')))
  })
  doc.querySelectorAll('area[href]').forEach((a) => {
    mergeLink(map, absUrl(base, a.getAttribute('href')))
  })

  doc.querySelectorAll('img[src],picture source[src],script[src],iframe[src]').forEach((el) => {
    mergeLink(map, absUrl(base, el.getAttribute('src')))
  })

  doc.querySelectorAll('video[src], audio[src]').forEach((el) => {
    const u = absUrl(base, el.getAttribute('src'))
    const tag = el.tagName.toLowerCase()
    if (u) mergeLink(map, u, tag === 'video' ? 'video_src' : 'audio_src')
  })
  doc.querySelectorAll('video source[src], audio source[src]').forEach((el) => {
    const parent = el.parentElement?.tagName.toLowerCase()
    const u = absUrl(base, el.getAttribute('src'))
    if (u) mergeLink(map, u, parent === 'video' ? 'video_src' : 'audio_src')
  })

  const urlInQuotes =
    /["'](https?:\/\/[^"'\\\s]+)["']/gi
  let m: RegExpExecArray | null
  while ((m = urlInQuotes.exec(html))) {
    mergeLink(map, m[1])
  }

  const m3u8Re = /https?:\/\/[^"'\\\s<>]+\.m3u8(?:\?[^"'\\\s<>]*)?/gi
  while ((m = m3u8Re.exec(html))) {
    mergeLink(map, m[0], 'hls')
  }

  const mpdRe = /https?:\/\/[^"'\\\s<>]+\.mpd(?:\?[^"'\\\s<>]*)?/gi
  while ((m = mpdRe.exec(html))) {
    mergeLink(map, m[0], 'dash')
  }

  const videoExtRe =
    /https?:\/\/[^"'\\\s<>]+\.(?:mp4|webm|mov|mkv|m4v|mp3|m4a|ogg)(?:\?[^"'\\\s<>]*)?/gi
  while ((m = videoExtRe.exec(html))) {
    mergeLink(map, m[0])
  }

  return [...map.values()].sort((a, b) => a.url.localeCompare(b.url))
}

export async function extractHttpLinksFromPage(
  pageUrl: string,
): Promise<{ links: RichPageLink[]; error?: string }> {
  try {
    const res = await fetch(pageUrl.trim(), { mode: 'cors', credentials: 'omit' })
    if (!res.ok) return { links: [], error: `HTTP ${res.status}` }
    const html = await res.text()
    const links = extractRichLinksFromHtml(html, pageUrl.trim())
    return { links }
  } catch (e) {
    return { links: [], error: (e as Error).message }
  }
}

export function guessNameFromUrl(url: string): string {
  const t = url.trim()
  if (/^magnet:/i.test(t)) {
    const q = t.includes('?') ? t.slice(t.indexOf('?') + 1) : ''
    const m = /(?:^|&)dn=([^&]+)/i.exec(q)
    if (m) {
      try {
        const n = decodeURIComponent(m[1])
        if (n) return sanitizeMagnetDn(n)
      } catch {
        const n = m[1]
        if (n) return sanitizeMagnetDn(n)
      }
    }
    return 'magnet'
  }
  try {
    const u = new URL(t)
    const seg = u.pathname.split('/').filter(Boolean).pop()
    if (seg) return decodeURIComponent(seg.split('?')[0] || seg)
  } catch {
    /* ignore */
  }
  return 'download'
}

function sanitizeMagnetDn(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 200) || 'magnet'
}
