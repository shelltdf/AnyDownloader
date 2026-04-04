/**
 * 打包前删除 release/，避免 Windows 上 electron-builder 无法覆盖 app.asar（文件被占用）。
 * 仍失败时：关闭 AnyDownloader.exe、Electron 开发进程，以及占用该目录的资源管理器/杀毒预览。
 */
const fs = require('fs')
const path = require('path')

const releaseDir = path.join(__dirname, '..', 'release')

function rmRelease() {
  if (!fs.existsSync(releaseDir)) return
  const major = parseInt(String(process.versions.node).split('.')[0], 10)
  const opts = { recursive: true, force: true }
  if (major >= 18 && process.platform === 'win32') {
    Object.assign(opts, { maxRetries: 6, retryDelay: 400 })
  }
  fs.rmSync(releaseDir, opts)
}

try {
  rmRelease()
  console.log('[clean-release] OK (release/ cleared or absent)')
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e)
  console.error('[clean-release] 无法删除 release/：', msg)
  console.error(
    '  → 请先关闭正在运行的 AnyDownloader / electron、结束 node 里挂起的 electron-builder，',
  )
  console.error('     并关闭对 release 文件夹的资源管理器窗口或预览窗格，然后重试。')
  process.exit(1)
}
