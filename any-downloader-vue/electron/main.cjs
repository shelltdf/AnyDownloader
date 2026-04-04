/**
 * Electron 主进程：生产态加载 Vite 构建后的 dist/index.html（file://）
 * 开发联调：先 npm run dev，再 ELECTRON_DEV=1 electron .
 */
const { app, BrowserWindow, ipcMain, Menu, dialog, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { registerVideoYtdlpIpc } = require('./video-ytdlp.cjs')
const { registerAria2BtIpc } = require('./aria2-bt.cjs')

const pkg = (() => {
  try {
    return require(path.join(__dirname, '..', 'package.json'))
  } catch {
    return { version: '' }
  }
})()

/** @type {BrowserWindow | null} */
let mainWindow = null
/** 是否使用系统原生标题栏 + 应用菜单（与页内自定义菜单/工具栏独立） */
let useNativeChrome = false

function windowPrefsPath() {
  return path.join(app.getPath('userData'), 'any-downloader-window.json')
}

function loadWindowPrefs() {
  try {
    const raw = fs.readFileSync(windowPrefsPath(), 'utf8')
    const j = JSON.parse(raw)
    if (typeof j.useNativeChrome === 'boolean') useNativeChrome = j.useNativeChrome
  } catch {
    /* default false */
  }
}

function saveWindowPrefs() {
  try {
    fs.mkdirSync(path.dirname(windowPrefsPath()), { recursive: true })
    fs.writeFileSync(windowPrefsPath(), JSON.stringify({ useNativeChrome }, null, 0), 'utf8')
  } catch (e) {
    console.error('saveWindowPrefs', e)
  }
}

function sanitizePathSegment(seg) {
  const s = String(seg || '')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/^\.+$/, '_')
    .slice(0, 200)
  return s || '_'
}

/** 允许相对子路径（段内净化），总长约上限 */
function sanitizeImportRelativePath(rel) {
  const parts = String(rel || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => sanitizePathSegment(s.trim()))
    .filter((s) => s.length > 0 && s !== '.')
  if (parts.length === 0) return 'download'
  const joined = parts.join('/')
  return joined.length > 500 ? joined.slice(0, 500) : joined
}

/** 与页内 favicon / 构建产物图标一致（build-resources/icon.png，由 scripts/gen-app-icon.cjs 生成） */
function resolveWindowIcon() {
  const png = path.join(__dirname, '..', 'build-resources', 'icon.png')
  if (!fs.existsSync(png)) return undefined
  try {
    const img = nativeImage.createFromPath(png)
    return img.isEmpty() ? undefined : img
  } catch {
    return undefined
  }
}

function buildAppMenu() {
  const isMac = process.platform === 'darwin'
  const zh = String(app.getLocale() || '')
    .toLowerCase()
    .startsWith('zh')
  const t = (a, b) => (zh ? a : b)
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = []
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    })
  }
  template.push(
    {
      label: t('文件', 'File'),
      submenu: [isMac ? { role: 'close' } : { role: 'quit', label: t('退出', 'Quit') }],
    },
    {
      label: t('编辑', 'Edit'),
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
      ],
    },
    {
      label: t('视图', 'View'),
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }],
    },
  )
  if (!isMac) {
    template.push({
      label: t('窗口', 'Window'),
      submenu: [{ role: 'minimize' }, { role: 'close', label: t('关闭', 'Close') }],
    })
  }
  return Menu.buildFromTemplate(template)
}

/**
 * 创建浏览器窗口（不写入 mainWindow；用于先建新窗再关旧窗，避免 window-all-closed → app.quit）。
 * @param {{ bounds?: Electron.Rectangle; maximized?: boolean } | null} restore
 * @returns {BrowserWindow}
 */
function instantiateWindow(restore) {
  const preloadPath = path.join(__dirname, 'preload.cjs')

  const ver = String(pkg.version || '').trim()
  const baseTitle = pkg.productName || 'AnyDownloader'
  const icon = resolveWindowIcon()
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    show: false,
    frame: useNativeChrome,
    title: ver ? `${baseTitle} v${ver}` : baseTitle,
    icon,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  function broadcastMaximized() {
    if (!win.isDestroyed()) {
      win.webContents.send('shell:maximized-changed', win.isMaximized())
    }
  }

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  if (useNativeChrome) {
    Menu.setApplicationMenu(buildAppMenu())
  } else {
    Menu.setApplicationMenu(null)
  }

  win.once('ready-to-show', () => {
    if (restore) {
      if (restore.maximized) win.maximize()
      else if (restore.bounds) win.setBounds(restore.bounds)
    }
    win.show()
  })
  win.on('maximize', broadcastMaximized)
  win.on('unmaximize', broadcastMaximized)
  win.webContents.on('did-finish-load', broadcastMaximized)

  const dev = process.env.ELECTRON_DEV === '1'
  if (dev) {
    win.loadURL('http://127.0.0.1:5173').catch(() => {
      win.loadURL('http://localhost:5173')
    })
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    const indexHtml = path.join(__dirname, '..', 'dist', 'index.html')
    win.loadFile(indexHtml)
  }

  return win
}

/**
 * @param {{ bounds?: Electron.Rectangle; maximized?: boolean } | null} restore
 */
function createWindow(restore) {
  const win = instantiateWindow(restore)
  mainWindow = win
  return win
}

function recreateMainWindow() {
  const oldWin = mainWindow
  if (!oldWin || oldWin.isDestroyed()) return
  const bounds = oldWin.getBounds()
  const maximized = oldWin.isMaximized()
  /** 必须先挂上新窗口，再 destroy 旧窗；否则会出现「瞬间 0 个窗口」触发 window-all-closed → quit（Windows/Linux）。 */
  const newWin = instantiateWindow({ bounds, maximized })
  mainWindow = newWin
  oldWin.destroy()
}

app.whenReady().then(() => {
  loadWindowPrefs()
  createWindow(null)

  registerVideoYtdlpIpc(ipcMain, dialog, BrowserWindow)
  const aria2Bt = registerAria2BtIpc(ipcMain)

  /** BT：退出前温和结束 aria2，便于 DHT 落盘（强杀/断电仍可能损坏，见 aria2-bt.cjs 注释） */
  let allowQuitAfterAria2 = false
  app.on('before-quit', (e) => {
    if (allowQuitAfterAria2) return
    e.preventDefault()
    void aria2Bt.gracefulShutdownAllAria2(6000).finally(() => {
      allowQuitAfterAria2 = true
      app.quit()
    })
  })

  ipcMain.handle('shell:get-version', () => String(pkg.version || ''))

  ipcMain.handle('shell:get-use-native-chrome', () => ({ useNativeChrome }))

  ipcMain.handle('shell:set-use-native-chrome', async (_event, value) => {
    const v = Boolean(value)
    if (v === useNativeChrome) return { ok: true }
    useNativeChrome = v
    saveWindowPrefs()
    setTimeout(() => recreateMainWindow(), 0)
    return { ok: true }
  })

  ipcMain.handle('shell:popup-chrome-menu', async (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    const p = payload && typeof payload === 'object' ? payload : {}
    const labels = p.labels && typeof p.labels === 'object' ? p.labels : {}
    const cx = Number(p.clientX)
    const cy = Number(p.clientY)
    const x = Number.isFinite(cx) ? Math.round(cx) : 0
    const y = Number.isFinite(cy) ? Math.round(cy) : 0
    const menu = Menu.buildFromTemplate([
      {
        label:
          typeof labels.nativeChrome === 'string' && labels.nativeChrome
            ? labels.nativeChrome
            : String(app.getLocale() || '')
                .toLowerCase()
                .startsWith('zh')
              ? '显示系统标题栏与菜单栏'
              : 'Show native title bar & menu bar',
        type: 'checkbox',
        checked: useNativeChrome,
        click: (item) => {
          const next = Boolean(item.checked)
          if (next !== useNativeChrome) {
            useNativeChrome = next
            saveWindowPrefs()
            setTimeout(() => recreateMainWindow(), 0)
          }
        },
      },
    ])
    menu.popup({ window: win, x, y })
  })

  ipcMain.handle('shell:pick-import-dir', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const bw = win && !win.isDestroyed() ? win : undefined
    const zh = String(app.getLocale() || '')
      .toLowerCase()
      .startsWith('zh')
    const r = await dialog.showOpenDialog(bw, {
      properties: ['openDirectory', 'createDirectory'],
      title: zh ? '选择网页导入的保存目录' : 'Choose folder for imports from page',
    })
    if (r.canceled || !r.filePaths.length) return null
    return { path: r.filePaths[0] }
  })

  /** 选择本地 .torrent 并读入缓冲区，供渲染进程解析（无需依赖 File.path） */
  ipcMain.handle('shell:pick-torrent-file', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const bw = win && !win.isDestroyed() ? win : undefined
    const zh = String(app.getLocale() || '')
      .toLowerCase()
      .startsWith('zh')
    const r = await dialog.showOpenDialog(bw, {
      properties: ['openFile'],
      filters: [{ name: 'BitTorrent', extensions: ['torrent'] }],
      title: zh ? '选择 BT 种子文件' : 'Choose .torrent file',
    })
    if (r.canceled || !r.filePaths.length) return null
    const filePath = r.filePaths[0]
    const buf = await fs.promises.readFile(filePath)
    const u8 = new Uint8Array(buf)
    return {
      path: filePath,
      href: pathToFileURL(filePath).href,
      data: u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength),
    }
  })

  ipcMain.handle('shell:write-import-file', async (_event, payload) => {
    const p = payload && typeof payload === 'object' ? payload : {}
    const dirPath = String(p.dirPath || '').trim()
    const fileName = sanitizeImportRelativePath(p.fileName)
    if (!dirPath || !fileName) throw new Error('INVALID_ARGS')
    const dirAbs = path.resolve(dirPath)
    let st
    try {
      st = await fs.promises.stat(dirAbs)
    } catch {
      throw new Error('NOT_A_DIR')
    }
    if (!st.isDirectory()) throw new Error('NOT_A_DIR')
    const outAbs = path.resolve(path.join(dirAbs, fileName))
    const rel = path.relative(dirAbs, outAbs)
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('INVALID_PATH')
    const raw = p.data
    let buf
    if (Buffer.isBuffer(raw)) buf = raw
    else if (raw instanceof ArrayBuffer) buf = Buffer.from(new Uint8Array(raw))
    else if (ArrayBuffer.isView(raw)) buf = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)
    else throw new Error('NO_DATA')
    await fs.promises.mkdir(path.dirname(outAbs), { recursive: true })
    const atomic = p.atomic !== false
    if (atomic) {
      const partAbs = `${outAbs}.part`
      try {
        await fs.promises.writeFile(partAbs, buf)
        await fs.promises.rename(partAbs, outAbs)
      } catch (e) {
        try {
          await fs.promises.unlink(partAbs)
        } catch {
          /* ignore */
        }
        throw e
      }
    } else {
      await fs.promises.writeFile(outAbs, buf)
    }
    return { ok: true }
  })

  ipcMain.on('shell:window-action', (event, action) => {
    const w = BrowserWindow.fromWebContents(event.sender)
    if (!w || w.isDestroyed()) return
    if (action === 'minimize') w.minimize()
    else if (action === 'maximize-toggle') {
      if (w.isMaximized()) w.unmaximize()
      else w.maximize()
    } else if (action === 'close') w.close()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(null)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
