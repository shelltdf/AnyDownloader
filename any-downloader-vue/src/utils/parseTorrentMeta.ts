import parseTorrent from 'parse-torrent'

export interface ParsedTorrentMeta {
  name: string
  infoHash: string
  length: number
  filesCount: number
  announceCount: number
}

function sanitizeDisplayName(s: string): string {
  return s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'torrent'
}

/**
 * 解析本地 .torrent 文件缓冲区（异步，与 parse-torrent v11 一致）。
 */
export async function parseTorrentFileBuffer(buf: ArrayBuffer): Promise<ParsedTorrentMeta> {
  const parsed = await parseTorrent(new Uint8Array(buf))
  if (!parsed.infoHash) throw new Error('INVALID_TORRENT')
  const name = sanitizeDisplayName(typeof parsed.name === 'string' ? parsed.name : 'torrent')
  const files = Array.isArray(parsed.files) ? parsed.files : []
  const announce = Array.isArray(parsed.announce) ? parsed.announce : []
  return {
    name,
    infoHash: String(parsed.infoHash).toLowerCase(),
    length: Number(parsed.length) || 0,
    filesCount: files.length,
    announceCount: announce.length,
  }
}
