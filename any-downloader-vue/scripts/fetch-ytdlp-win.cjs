/**
 * 下载官方 Windows 版 yt-dlp.exe 到 build-resources/yt-dlp/
 * 供 Windows 安装包 extraResources 使用。许可证：Unlicense（见上游仓库）。
 * https://github.com/yt-dlp/yt-dlp
 */
const fs = require('fs')
const path = require('path')
const https = require('https')

const RELEASE_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'

const root = path.join(__dirname, '..')
const outDir = path.join(root, 'build-resources', 'yt-dlp')
const exePath = path.join(outDir, 'yt-dlp.exe')

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const tryOnce = (u) => {
      https
        .get(u, { headers: { 'User-Agent': 'any-downloader-fetch-ytdlp' } }, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
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

async function main() {
  fs.mkdirSync(outDir, { recursive: true })

  if (fs.existsSync(exePath)) {
    console.log('[fetch-ytdlp] skip: exists', exePath)
    return
  }

  const tmp = path.join(outDir, '_yt-dlp.exe.download')
  console.log('[fetch-ytdlp] downloading', RELEASE_URL)
  await download(RELEASE_URL, tmp)
  fs.renameSync(tmp, exePath)
  console.log('[fetch-ytdlp] ok', exePath)
}

main().catch((e) => {
  console.error('[fetch-ytdlp]', e)
  process.exit(1)
})
