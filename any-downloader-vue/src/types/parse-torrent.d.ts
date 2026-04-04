/**
 * parse-torrent 无官方 @types，此处为 v11 异步 API 的最小声明。
 * @see https://github.com/webtorrent/parse-torrent
 */
declare module 'parse-torrent' {
  export interface ParseTorrentResult {
    infoHash?: string | Uint8Array
    name?: string
    length?: number
    files?: unknown[]
    announce?: unknown
    [key: string]: unknown
  }

  function parseTorrent(torrent: Uint8Array | ArrayBuffer | string): Promise<ParseTorrentResult>
  export default parseTorrent
}
