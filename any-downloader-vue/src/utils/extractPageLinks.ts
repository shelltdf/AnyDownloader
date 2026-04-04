/** 从网页 HTML 提取 http(s) 链接（需目标页允许 CORS） */

export async function extractHttpLinksFromPage(pageUrl: string): Promise<{ links: string[]; error?: string }> {
  try {
    const res = await fetch(pageUrl.trim(), { mode: 'cors', credentials: 'omit' })
    if (!res.ok) return { links: [], error: `HTTP ${res.status}` }
    const html = await res.text()
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const set = new Set<string>()
    doc.querySelectorAll('a[href]').forEach((a) => {
      const href = (a as HTMLAnchorElement).href
      if (/^https?:\/\//i.test(href)) set.add(href)
    })
    doc.querySelectorAll('link[href]').forEach((l) => {
      const href = (l as HTMLLinkElement).href
      if (/^https?:\/\//i.test(href)) set.add(href)
    })
    doc.querySelectorAll('[src]').forEach((el) => {
      const src = (el as HTMLElement).getAttribute('src')
      if (src && /^https?:\/\//i.test(src)) set.add(src)
    })
    return { links: [...set].sort() }
  } catch (e) {
    return { links: [], error: (e as Error).message }
  }
}

export function guessNameFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const seg = u.pathname.split('/').filter(Boolean).pop()
    if (seg) return decodeURIComponent(seg.split('?')[0] || seg)
  } catch {
    /* ignore */
  }
  return 'download'
}
