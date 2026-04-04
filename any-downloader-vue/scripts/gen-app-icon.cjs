/**
 * 生成与 public/favicon.svg 一致的 build-resources/icon.png（256×256，供 Electron 窗口/任务栏与 electron-builder）。
 * 运行：node scripts/gen-app-icon.cjs
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

const W = 256
const H = 256
const px = Buffer.alloc(W * H * 4)

function setPixel(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= W || y >= H) return
  const i = (y * W + x) * 4
  px[i] = r
  px[i + 1] = g
  px[i + 2] = b
  px[i + 3] = a
}

function fillBg() {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      setPixel(x, y, 0x63, 0x66, 0xf1, 0xff)
    }
  }
}

/** 圆角矩形内（与 favicon rx=6 / 32 比例一致） */
function insideRoundedRect(x, y) {
  const s = W / 32
  const r = 6 * s
  const w = W - 1
  const h = H - 1
  const eps = 2
  if (x < r && y < r) {
    const cx = r
    const cy = r
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r + eps
  }
  if (x > w - r && y < r) {
    const cx = w - r
    const cy = r
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r + eps
  }
  if (x < r && y > h - r) {
    const cx = r
    const cy = h - r
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r + eps
  }
  if (x > w - r && y > h - r) {
    const cx = w - r
    const cy = h - r
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r + eps
  }
  return x >= 0 && y >= 0 && x <= w && y <= h
}

function applyRoundedMask() {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!insideRoundedRect(x, y)) setPixel(x, y, 0, 0, 0, 0)
    }
  }
}

function strokeDisk(cx, cy, rad) {
  const r2 = rad * rad
  for (let dy = -rad; dy <= rad; dy++) {
    for (let dx = -rad; dx <= rad; dx++) {
      if (dx * dx + dy * dy <= r2 + rad) setPixel(Math.round(cx + dx), Math.round(cy + dy), 255, 255, 255, 255)
    }
  }
}

/** favicon path M16 7 v11 l6 3，viewBox 32→256 */
function drawArrow() {
  const s = W / 32
  const x0 = 16 * s
  const y0 = 7 * s
  const y1 = 18 * s
  const x2 = 22 * s
  const y2 = 21 * s
  const steps = 80
  function walk(ax, ay, bx, by) {
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const x = ax + (bx - ax) * t
      const y = ay + (by - ay) * t
      strokeDisk(x, y, 2.2)
    }
  }
  walk(x0, y0, x0, y1)
  walk(x0, y1, x2, y2)
}

fillBg()
drawArrow()
applyRoundedMask()

const rows = []
for (let y = 0; y < H; y++) {
  const row = Buffer.alloc(1 + W * 4)
  row[0] = 0
  px.copy(row, 1, y * W * 4, (y + 1) * W * 4)
  rows.push(row)
}
const raw = Buffer.concat(rows)
const idat = zlib.deflateSync(raw, { level: 9 })

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8
ihdr[9] = 6
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const png = Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])

const outDir = path.join(__dirname, '..', 'build-resources')
fs.mkdirSync(outDir, { recursive: true })
const outPath = path.join(outDir, 'icon.png')
fs.writeFileSync(outPath, png)
console.log('wrote', outPath)
