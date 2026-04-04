/**
 * Electron 主进程：通过系统 PATH 中的 yt-dlp（或 python -m yt_dlp）下载视频。
 * 网页版无此能力；仅套壳注册 IPC。
 */
const path = require('path')
const { spawn } = require('child_process')

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<void>}
 */
function runCmd(command, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(command, args, { shell: false })
    let stderr = ''
    p.stderr?.on('data', (d) => {
      stderr += d.toString()
    })
    p.on('error', () => reject(new Error('SPAWN_FAILED')))
    p.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `exit ${code}`))
    })
  })
}

let ytdlpCache = null

/**
 * @param {boolean} force
 * @returns {Promise<{ exe: string, prefix: string[] } | null>}
 */
async function resolveYtDlp(force = false) {
  if (!force && ytdlpCache) return ytdlpCache
  ytdlpCache = null
  const envPath = String(process.env.YT_DLP_PATH || '').trim()
  const tries = []
  if (envPath) tries.push({ exe: envPath, prefix: [] })
  tries.push(
    { exe: 'yt-dlp', prefix: [] },
    { exe: 'yt-dlp.exe', prefix: [] },
    { exe: 'python', prefix: ['-m', 'yt_dlp'] },
    { exe: 'python3', prefix: ['-m', 'yt_dlp'] },
    { exe: 'py', prefix: ['-m', 'yt_dlp'] },
  )
  for (const { exe, prefix } of tries) {
    try {
      await runCmd(exe, [...prefix, '--version'])
      ytdlpCache = { exe, prefix }
      return ytdlpCache
    } catch {
      /* try next */
    }
  }
  return null
}

/**
 * @param {unknown} u
 * @returns {string}
 */
function sanitizeUrl(u) {
  const s = String(u ?? '').trim()
  if (!s || s.length > 4096) throw new Error('INVALID_URL')
  let parsed
  try {
    parsed = new URL(s)
  } catch {
    throw new Error('INVALID_URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('INVALID_URL')
  return s
}

/**
 * @param {import('electron').IpcMain} ipcMain
 * @param {import('electron').Dialog} dialog
 * @param {typeof import('electron').BrowserWindow} BrowserWindow
 */
function registerVideoYtdlpIpc(ipcMain, dialog, BrowserWindow) {
  /** @type {Map<number, { proc: import('child_process').ChildProcess | null, cancelled: boolean }>} */
  const activeByWcId = new Map()

  ipcMain.handle('video:cancel-download', async (event) => {
    const ent = activeByWcId.get(event.sender.id)
    if (ent) {
      ent.cancelled = true
      try {
        ent.proc?.kill()
      } catch {
        /* ignore */
      }
      activeByWcId.delete(event.sender.id)
    }
    return { ok: true }
  })

  ipcMain.handle('video:check-ytdlp', async (_event, opts) => {
    const force = Boolean(opts && opts.force)
    const r = await resolveYtDlp(force)
    if (!r) return { available: false }
    const via = r.prefix.length ? `${r.exe} ${r.prefix.join(' ')}` : r.exe
    return { available: true, via }
  })

  ipcMain.handle('video:pick-output-dir', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const bw = win && !win.isDestroyed() ? win : undefined
    const r = await dialog.showOpenDialog(bw, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select folder for video download',
    })
    if (r.canceled || !r.filePaths.length) return null
    return r.filePaths[0]
  })

  ipcMain.handle('video:start-download', async (event, payload) => {
    const wc = event.sender
    const url = sanitizeUrl(payload && payload.url)
    const outputDir = String((payload && payload.outputDir) || '').trim()
    if (!outputDir) throw new Error('NO_OUTPUT_DIR')

    const r = await resolveYtDlp(false)
    if (!r) throw new Error('NO_YT_DLP')

    const outTemplate = path.join(outputDir, '%(title)s [%(id)s].%(ext)s')
    const args = [...r.prefix, '--newline', '--no-playlist', '--no-cache-dir', '-o', outTemplate, url]

    return new Promise((resolve, reject) => {
      const ent = { proc: /** @type {import('child_process').ChildProcess | null} */ (null), cancelled: false }
      activeByWcId.set(wc.id, ent)
      const p = spawn(r.exe, args, {
        cwd: outputDir,
        env: { ...process.env },
        shell: false,
      })
      ent.proc = p
      const send = (buf) => {
        if (wc.isDestroyed()) return
        wc.send('video:ytdlp-log', { chunk: buf.toString() })
      }
      p.stdout?.on('data', send)
      p.stderr?.on('data', send)
      let settled = false
      const finish = () => {
        activeByWcId.delete(wc.id)
      }
      p.on('error', (err) => {
        finish()
        if (!settled) {
          settled = true
          reject(err)
        }
      })
      p.on('close', (code) => {
        finish()
        if (settled) return
        settled = true
        if (ent.cancelled) {
          resolve({ ok: false, cancelled: true })
          return
        }
        if (code === 0) resolve({ ok: true })
        else reject(new Error(`YTDLP_EXIT_${code}`))
      })
    })
  })
}

module.exports = { registerVideoYtdlpIpc }
