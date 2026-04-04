export type DetectedProtocol =
  | 'https'
  | 'http'
  | 'ftp'
  | 'ftps'
  | 'sftp'
  | 'magnet'
  | 'ed2k'
  | 'data'
  | 'blob'
  | 'ws'
  | 'wss'
  | 'file'
  | 'thunder'
  | 'flashget'
  | 'qqdl'
  | 'ipfs'
  | 'ipns'
  | 'rtsp'
  | 'mms'
  | 's3'
  | 'git'
  | 'dav'
  | 'davs'
  | 'unknown'

export interface ProtocolDetectResult {
  protocol: DetectedProtocol
  href: string
  displayUrl: string
}

function tryParse(raw: string): URL | null {
  const t = raw.trim()
  if (!t) return null
  try {
    return new URL(t)
  } catch {
    try {
      return new URL(`https://${t}`)
    } catch {
      return null
    }
  }
}

/** URL-safe / 标准 Base64 解码为二进制字符串（Latin-1） */
function b64DecodeToBinary(payload: string): string | null {
  let p = payload.trim()
  try {
    p = decodeURIComponent(p)
  } catch {
    /* 非 URL 编码则沿用 */
  }
  const normalized = p.replace(/-/g, '+').replace(/_/g, '/')
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  try {
    return atob(normalized + pad)
  } catch {
    return null
  }
}

function decodeThunderInner(raw: string): string | null {
  if (!/^thunder:\/\//i.test(raw)) return null
  const rest = raw.replace(/^thunder:\/\//i, '')
  const bin = b64DecodeToBinary(rest)
  if (!bin) return null
  if (bin.startsWith('AA') && bin.endsWith('ZZ') && bin.length > 4) return bin.slice(2, -2)
  return null
}

function decodeFlashgetInner(raw: string): string | null {
  if (!/^flashget:\/\//i.test(raw)) return null
  const rest = raw.replace(/^flashget:\/\//i, '')
  const bin = b64DecodeToBinary(rest)
  if (!bin) return null
  const m = /\[(?:FLASHGET|flashget)\]([^\[]+)\[(?:FLASHGET|flashget)\]/i.exec(bin)
  if (m) return m[1].trim()
  const t = bin.trim()
  if (/^https?:\/\//i.test(t)) return t
  return null
}

function decodeQqdlInner(raw: string): string | null {
  if (!/^qqdl:\/\//i.test(raw)) return null
  const rest = raw.replace(/^qqdl:\/\//i, '')
  const bin = b64DecodeToBinary(rest)
  if (!bin) return null
  const t = bin.trim()
  if (/^https?:\/\//i.test(t)) return t
  const m = /(https?:\/\/[^\s]+)/i.exec(t)
  return m ? m[1].trim() : null
}

/**
 * 将迅雷 / 快车 / QQ 旋风等专用链展开为内层地址（常见为 HTTP URL）。
 * 无法识别则返回原串（trim 后）。
 */
export function expandLegacyDownloadLink(raw: string): string {
  let s = raw.trim()
  for (let i = 0; i < 4; i++) {
    const next =
      decodeThunderInner(s) ?? decodeFlashgetInner(s) ?? decodeQqdlInner(s)
    if (!next || next === s) break
    s = next.trim()
  }
  return s
}

const SCHEME_MAP: Record<string, DetectedProtocol> = {
  'https:': 'https',
  'http:': 'http',
  'ftp:': 'ftp',
  'ftps:': 'ftps',
  'sftp:': 'sftp',
  'data:': 'data',
  'blob:': 'blob',
  'ws:': 'ws',
  'wss:': 'wss',
  'file:': 'file',
  'ipfs:': 'ipfs',
  'ipns:': 'ipns',
  'rtsp:': 'rtsp',
  'mms:': 'mms',
  'dav:': 'dav',
  'davs:': 'davs',
  'git:': 'git',
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/** 根据地址自动识别下载相关协议（含国内常用专用链） */
export function detectProtocol(input: string): ProtocolDetectResult | null {
  const t = input.trim()
  if (!t) return null

  const expanded = expandLegacyDownloadLink(t)

  if (/^magnet:/i.test(expanded)) {
    return { protocol: 'magnet', href: expanded, displayUrl: truncate(expanded, 96) }
  }
  if (/^ed2k:\/\//i.test(expanded)) {
    return { protocol: 'ed2k', href: expanded, displayUrl: expanded }
  }
  if (/^thunder:\/\//i.test(expanded)) {
    return { protocol: 'thunder', href: expanded, displayUrl: truncate(expanded, 120) }
  }
  if (/^flashget:\/\//i.test(expanded)) {
    return { protocol: 'flashget', href: expanded, displayUrl: truncate(expanded, 120) }
  }
  if (/^qqdl:\/\//i.test(expanded)) {
    return { protocol: 'qqdl', href: expanded, displayUrl: truncate(expanded, 120) }
  }
  if (/^s3:\/\//i.test(expanded)) {
    return { protocol: 's3', href: expanded, displayUrl: truncate(expanded, 96) }
  }
  if (/^data:/i.test(expanded)) {
    return { protocol: 'data', href: expanded, displayUrl: truncate(expanded, 80) }
  }

  const u = tryParse(expanded)
  if (!u) return null
  const key = u.protocol.toLowerCase()
  const p = SCHEME_MAP[key] ?? 'unknown'
  return { protocol: p, href: u.href, displayUrl: u.href }
}

export function protocolLabel(p: DetectedProtocol): string {
  const labels: Record<DetectedProtocol, string> = {
    https: 'HTTPS',
    http: 'HTTP',
    ftp: 'FTP',
    ftps: 'FTPS',
    sftp: 'SFTP',
    magnet: 'Magnet',
    ed2k: 'eD2k',
    data: 'Data URL',
    blob: 'Blob',
    ws: 'WebSocket',
    wss: 'WebSocket (TLS)',
    file: 'file',
    thunder: '迅雷',
    flashget: '快车',
    qqdl: 'QQ旋风',
    ipfs: 'IPFS',
    ipns: 'IPNS',
    rtsp: 'RTSP',
    mms: 'MMS',
    s3: 'S3',
    git: 'Git',
    dav: 'WebDAV',
    davs: 'WebDAV (TLS)',
    unknown: '?',
  }
  return labels[p]
}
