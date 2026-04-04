/**
 * 解析 aria2 单行进度（控制台），例如：
 * [#d49b5f 368KiB/544MiB(0%) CN:1 SD:0 DL:27KiB ETA:5h38m13s]
 */

export interface Aria2ParsedProgress {
  completedBytes: number
  totalBytes: number
  dlBps: number
  connectionCount: number
}

/** 解析如 0B、368KiB、1.2MiB、544MiB（与 aria2 控制台一致，二进制前缀） */
export function parseAria2ByteToken(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const m = /^([\d.]+)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB|B)$/i.exec(t)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  const u = m[2].toUpperCase()
  const mult =
    u === 'B'
      ? 1
      : u === 'KIB' || u === 'KB'
        ? 1024
        : u === 'MIB' || u === 'MB'
          ? 1024 ** 2
          : u === 'GIB' || u === 'GB'
            ? 1024 ** 3
            : u === 'TIB' || u === 'TB'
              ? 1024 ** 4
              : 1
  return n * mult
}

/**
 * 从一行 stderr 提取进度；无法识别则返回 null。
 * aria2 常带日期/级别前缀，例如：`04/05 00:04:37 [NOTICE] [#gid 16KiB/544MiB(0%) CN:2 … DL:172KiB ETA:54m]`
 * 故从 `[#` 子串起解析，而非要求行首即为 `[#`。
 */
export function parseAria2ProgressLine(line: string): Aria2ParsedProgress | null {
  const trimmed = line.trim()
  const hashIdx = trimmed.indexOf('[#')
  if (hashIdx < 0) return null
  const tail = trimmed.slice(hashIdx)
  /** DL 后可能紧跟 `]` 结束进度块（无空格），勿用 `\S+` 以免吞入 `]` 导致 `0B]` 解析失败 */
  const m = /^\[#\S+\s+(\S+)\/(\S+)(?:\([^)]*\))?\s+CN:(\d+)\s+SD:\d+\s+DL:([^\s\]]+)/.exec(tail)
  if (!m) return null
  const got = parseAria2ByteToken(m[1])
  const total = parseAria2ByteToken(m[2])
  const cn = Number.parseInt(m[3], 10)
  const dl = parseAria2ByteToken(m[4])
  if (got == null || total == null || dl == null || !Number.isFinite(cn)) return null
  return {
    completedBytes: Math.max(0, got),
    totalBytes: Math.max(0, total),
    dlBps: Math.max(0, dl),
    connectionCount: Math.max(0, cn),
  }
}

/**
 * 控制台用 `\r` 同行动态刷新时，一行内可能残留多段 `[#…]`（或管道化后挤在一行）。
 * 对整段文本取**最后一个**可解析的进度块（通常最新）。
 */
export function parseLastAria2ProgressFromLine(line: string): Aria2ParsedProgress | null {
  const trimmed = line.trim()
  if (!trimmed.includes('[#')) return null
  const segments = trimmed.split(/(?=\[#)/)
  let last: Aria2ParsedProgress | null = null
  for (const seg of segments) {
    const t = seg.trim()
    if (!t.startsWith('[#')) continue
    const p = parseAria2ProgressLine(t)
    if (p) last = p
  }
  return last
}

/** 行内 `\r` 表示回到行首覆盖：保留最后一个 `\r` 之后的内容（与 `\n` 分行配合使用） */
export function stripTerminalCarriageReturn(line: string): string {
  const i = line.lastIndexOf('\r')
  return i < 0 ? line : line.slice(i + 1)
}
