/**
 * Electron preload：向页面暴露最小壳层 API（contextIsolation + sandbox）
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('anyDownloaderShell', {
  isElectron: true,
  getVersion: () => ipcRenderer.invoke('shell:get-version'),
  getUseNativeChrome: () => ipcRenderer.invoke('shell:get-use-native-chrome'),
  setUseNativeChrome: (value) => ipcRenderer.invoke('shell:set-use-native-chrome', Boolean(value)),
  /**
   * @param {{ clientX: number; clientY: number; labels?: { nativeChrome?: string } }} payload
   */
  popupShellChromeMenu: (payload) => ipcRenderer.invoke('shell:popup-chrome-menu', payload),
  pickImportDirectory: () => ipcRenderer.invoke('shell:pick-import-dir'),
  /**
   * @param {{ dirPath: string; fileName: string; data: ArrayBuffer }} opts
   */
  writeImportFile: (opts) => ipcRenderer.invoke('shell:write-import-file', opts),
  checkYtdlp: (force) => ipcRenderer.invoke('video:check-ytdlp', { force: Boolean(force) }),
  pickVideoOutputDir: () => ipcRenderer.invoke('video:pick-output-dir'),
  startVideoDownload: (payload) => ipcRenderer.invoke('video:start-download', payload),
  cancelVideoDownload: () => ipcRenderer.invoke('video:cancel-download'),
  /**
   * @param {(data: { chunk: string }) => void} callback
   * @returns {() => void}
   */
  onVideoYtdlpLog(callback) {
    const handler = (_event, data) => {
      callback(data)
    }
    ipcRenderer.on('video:ytdlp-log', handler)
    return () => {
      ipcRenderer.removeListener('video:ytdlp-log', handler)
    }
  },
  windowAction: (action) => {
    if (action === 'minimize' || action === 'maximize-toggle' || action === 'close') {
      ipcRenderer.send('shell:window-action', action)
    }
  },
  /**
   * @param {(maximized: boolean) => void} callback
   * @returns {() => void} unsubscribe
   */
  onMaximizedChange(callback) {
    const handler = (_event, value) => {
      callback(Boolean(value))
    }
    ipcRenderer.on('shell:maximized-changed', handler)
    return () => {
      ipcRenderer.removeListener('shell:maximized-changed', handler)
    }
  },
})
