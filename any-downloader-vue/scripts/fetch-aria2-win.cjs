/**
 * 下载官方 Windows 64 位 aria2 发布包，解压出 aria2c.exe（及 COPYING）到 build-resources/aria2/
 * 供 Windows 安装包 extraResources 使用。GPL-2.0+，见 COPYING。
 *
 * 使用 adm-zip 解压，便于在 Linux/macOS CI 上为 --win 目标准备文件。
 * 已存在 aria2c.exe 时跳过。
 */
const fs = require('fs')
const path = require('path')
const https = require('https')
const AdmZip = require('adm-zip')

const VERSION = '1.37.0'
const ZIP_NAME = `aria2-${VERSION}-win-64bit-build1.zip`
const RELEASE_URL = `https://github.com/aria2/aria2/releases/download/release-${VERSION}/${ZIP_NAME}`

const root = path.join(__dirname, '..')
const outDir = path.join(root, 'build-resources', 'aria2')
const exePath = path.join(outDir, 'aria2c.exe')
const zipPath = path.join(outDir, '_download.zip')

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const tryOnce = (u) => {
      https
        .get(u, { headers: { 'User-Agent': 'any-downloader-fetch-aria2' } }, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            const loc = res.headers.location
            if (!loc) {
              reject(new Error('Redirect without location'))
              return
            }
            tryOnce(new URL(loc, u).href)
            return
          }
          if (res.statusCode !== 200) {
            reject(new Error(`GET ${u} → HTTP ${res.statusCode}`))
            return
          }
          const w = fs.createWriteStream(dest)
          res.pipe(w)
          w.on('finish', () => w.close(() => resolve()))
          w.on('error', reject)
        })
        .on('error', reject)
    }
    tryOnce(url)
  })
}

function findFileRecursive(dir, baseName) {
  if (!fs.existsSync(dir)) return null
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      const r = findFileRecursive(p, baseName)
      if (r) return r
    } else if (name.toLowerCase() === baseName.toLowerCase()) {
      return p
    }
  }
  return null
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true })

  if (fs.existsSync(exePath)) {
    console.log('[fetch-aria2] skip: exists', exePath)
    return
  }

  console.log('[fetch-aria2] downloading', RELEASE_URL)
  await download(RELEASE_URL, zipPath)

  const zip = new AdmZip(zipPath)
  const tmpDir = path.join(outDir, '_extract')
  fs.rmSync(tmpDir, { recursive: true, force: true })
  fs.mkdirSync(tmpDir, { recursive: true })
  zip.extractAllTo(tmpDir, true)

  const foundExe = findFileRecursive(tmpDir, 'aria2c.exe')
  if (!foundExe) {
    throw new Error('aria2c.exe not found in zip')
  }
  fs.copyFileSync(foundExe, exePath)
  console.log('[fetch-aria2] wrote', exePath)

  const copying = findFileRecursive(tmpDir, 'COPYING')
  if (copying) {
    const destCopying = path.join(outDir, 'COPYING')
    fs.copyFileSync(copying, destCopying)
    console.log('[fetch-aria2] wrote', destCopying)
  }

  fs.rmSync(tmpDir, { recursive: true, force: true })
  try {
    fs.unlinkSync(zipPath)
  } catch {
    /* ignore */
  }
}

main().catch((e) => {
  console.error('[fetch-aria2] failed:', e.message)
  process.exit(1)
})
