/**
 * Electron 主进程：生产态加载 Vite 构建后的 dist/index.html（file://）
 * 开发联调：先 npm run dev，再 ELECTRON_DEV=1 electron .
 */
const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron')
const path = require('path')
const { registerVideoYtdlpIpc } = require('./video-ytdlp.cjs')

const pkg = (() => {
  try {
    return require(path.join(__dirname, '..', 'package.json'))
  } catch {
    return { version: '' }
  }
})()

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.cjs')

  const ver = String(pkg.version || '').trim()
  const baseTitle = pkg.productName || 'AnyDownloader'
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    show: false,
    frame: false,
    title: ver ? `${baseTitle} v${ver}` : baseTitle,
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

  win.once('ready-to-show', () => win.show())
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

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()

  registerVideoYtdlpIpc(ipcMain, dialog, BrowserWindow)

  ipcMain.handle('shell:get-version', () => String(pkg.version || ''))

  ipcMain.on('shell:window-action', (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    if (action === 'minimize') win.minimize()
    else if (action === 'maximize-toggle') {
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    } else if (action === 'close') win.close()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
