/**
 * Electron 主进程：生产态加载 Vite 构建后的 dist/index.html（file://）
 * 开发联调：先 npm run dev，再 ELECTRON_DEV=1 electron .
 */
const { app, BrowserWindow } = require('electron')
const path = require('path')

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  win.once('ready-to-show', () => win.show())

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
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
