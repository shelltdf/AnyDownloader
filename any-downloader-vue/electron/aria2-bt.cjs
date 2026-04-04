/**
 * Electron：aria2c 处理 magnet / .torrent。
 * 解析顺序：ARIA2_PATH → 打包内置 resources/aria2/aria2c.exe（Windows）→
 * 开发目录 build-resources/aria2/aria2c.exe → PATH。
 */
const fs = require('fs')
const path = require('path')
const { spawn, execFile } = require('child_process')
const { fileURLToPath } = require('url')
const os = require('os')

/**
 * DHT 路由表放在应用目录，避免默认 ~/.cache/aria2/dht.dat 损坏时反复报错；
 * 若 stderr 提示加载失败则删除该文件，下次 spawn 由 aria2 重建。
 */
function getAria2StatePaths() {
  try {
    const { app } = require('electron')
    const base = app.getPath('userData')
    const dir = path.join(base, 'aria2')
    return {
      dir,
      /** IPv4 DHT 路由表；勿加 `--dht6-file-path`：多数 Windows 捆绑版无此选项 → OPTION_ERROR / 退出码 28 */
      dhtFile: path.join(dir, 'dht.dat'),
    }
  } catch {
    const dir = path.join(os.tmpdir(), 'any-downloader-aria2')
    return {
      dir,
      dhtFile: path.join(dir, 'dht.dat'),
    }
  }
}

/** aria2 先发「loading … from」一行，再发 DHTRoutingTableDeserializer /「Failed to load…」；须两行都能命中才会删表 */
const DHT_FAIL_RE =
  /Exception caught while loading DHT routing table|Failed to load DHT routing table|DHTRoutingTableDeserializer\.cc/i

/**
 * 同步删路由表（stderr 命中须立刻删；仅 async 在 Windows 上可能晚于 aria2 再次读表）。
 * @param {string} dir
 * @param {string} dhtFile
 */
function clearDhtRoutingFileSync(dir, dhtFile) {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(dhtFile)
  } catch (e) {
    const err = /** @type {NodeJS.ErrnoException} */ (e)
    if (err && err.code === 'ENOENT') return
    throw err
  }
}

/**
 * 上次检测到损坏但删除失败时落盘，下次任务开始前再试。
 */
function applyPendingDhtClearSync() {
  const { dir, dhtFile } = getAria2StatePaths()
  const flag = path.join(dir, '.dht-clear-next')
  if (!fs.existsSync(flag)) return
  try {
    clearDhtRoutingFileSync(dir, dhtFile)
    fs.unlinkSync(flag)
  } catch {
    /* 保留 flag 下次再试 */
  }
}

function markPendingDhtClearSync(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, '.dht-clear-next'), '1', 'utf8')
  } catch {
    /* ignore */
  }
}

/**
 * 启动 aria2 前：处理待删标志；0 字节文件无法构成有效路由表，直接删掉以免反复报错。
 * @param {{ dir: string, dhtFile: string }} state
 */
function prepareDhtFileBeforeSpawn(state) {
  applyPendingDhtClearSync()
  try {
    if (!fs.existsSync(state.dhtFile)) return
    const st = fs.statSync(state.dhtFile)
    if (st.size === 0) {
      fs.unlinkSync(state.dhtFile)
    }
  } catch {
    /* ignore */
  }
}

/**
 * DHT `dht.dat` 在进程退出时由 aria2 写回磁盘；若此时进程被强杀、崩溃、断电或磁盘满，
 * 文件可能只有半截 → 下次启动反序列化失败。强制关窗口若直接 `kill()`（尤其 Windows 上
 * Node 子进程常为立即终止），更容易踩中。此处退出应用时先尝试温和结束，给 aria2 时间刷盘。
 *
 * @param {import('child_process').ChildProcess | null} proc
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
function killAria2ChildGracefully(proc, timeoutMs) {
  if (!proc || proc.killed) return Promise.resolve()
  const pid = proc.pid
  if (pid == null) return Promise.resolve()

  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    proc.once('close', finish)
    const timer = setTimeout(() => {
      proc.removeListener('close', finish)
      try {
        if (process.platform === 'win32') {
          execFile('taskkill', ['/F', '/T', '/PID', String(pid)], () => finish())
        } else {
          try {
            proc.kill('SIGKILL')
          } catch {
            /* ignore */
          }
          finish()
        }
      } catch {
        finish()
      }
    }, timeoutMs)

    try {
      if (process.platform === 'win32') {
        execFile('taskkill', ['/PID', String(pid)], () => {})
      } else {
        proc.kill('SIGTERM')
      }
    } catch {
      finish()
    }
  })
}

/**
 * Windows：内置副本候选路径（打包后 resources 与开发目录）。
 * @returns {string[]}
 */
function getBundledAria2cCandidates() {
  if (process.platform !== 'win32') return []
  const list = []
  try {
    const { app } = require('electron')
    if (app?.isPackaged && process.resourcesPath) {
      list.push(path.join(process.resourcesPath, 'aria2', 'aria2c.exe'))
    }
  } catch {
    /* 无 electron（极少） */
  }
  list.push(path.join(__dirname, '..', 'build-resources', 'aria2', 'aria2c.exe'))
  return [...new Set(list)]
}

/**
 * @param {string} p
 * @returns {boolean}
 */
function fileExists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK)
    return true
  } catch {
    return false
  }
}

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

let aria2Cache = null

/**
 * @param {boolean} force
 * @returns {Promise<string | null>}
 */
async function resolveAria2c(force = false) {
  if (!force && aria2Cache) return aria2Cache
  aria2Cache = null
  const envPath = String(process.env.ARIA2_PATH || '').trim()
  const tries = []
  if (envPath) tries.push(envPath)
  for (const p of getBundledAria2cCandidates()) {
    if (fileExists(p)) tries.push(p)
  }
  tries.push('aria2c', 'aria2c.exe')
  for (const exe of tries) {
    try {
      await runCmd(exe, ['--version'])
      aria2Cache = exe
      return exe
    } catch {
      /* try next */
    }
  }
  return null
}

/**
 * @param {import('electron').IpcMain} ipcMain
 */
function registerAria2BtIpc(ipcMain) {
  /** @type {Map<number, { proc: import('child_process').ChildProcess | null, cancelled: boolean }>} */
  const activeByWcId = new Map()

  ipcMain.handle('bt:check-aria2', async (_event, opts) => {
    const force = Boolean(opts && opts.force)
    const exe = await resolveAria2c(force)
    if (!exe) return { available: false }
    return { available: true, via: exe }
  })

  ipcMain.handle('bt:cancel', async (event) => {
    const ent = activeByWcId.get(event.sender.id)
    if (ent) {
      ent.cancelled = true
      try {
        ent.proc?.kill()
      } catch {
        /* ignore */
      }
      ent.proc = null
    }
    activeByWcId.delete(event.sender.id)
    return { ok: true }
  })

  ipcMain.handle('bt:start', async (event, payload) => {
    const wc = event.sender
    const p = payload && typeof payload === 'object' ? payload : {}
    const outputDir = String(p.outputDir || '').trim()
    if (!outputDir) throw new Error('NO_OUTPUT_DIR')

    const dhtState = getAria2StatePaths()
    await fs.promises.mkdir(dhtState.dir, { recursive: true })
    prepareDhtFileBeforeSpawn(dhtState)

    const prev = activeByWcId.get(wc.id)
    if (prev?.proc) {
      try {
        prev.proc.kill()
      } catch {
        /* ignore */
      }
    }

    const exe = await resolveAria2c(false)
    if (!exe) throw new Error('NO_ARIA2')

    const magnetUri = typeof p.magnetUri === 'string' ? p.magnetUri.trim() : ''
    const torrentFileUrl = typeof p.torrentFileUrl === 'string' ? p.torrentFileUrl.trim() : ''

    /**
     * 仅磁力/冷门种子时，部分链接缺少可用 Tracker；追加公共 announce 便于发现 Peer（与 DHT 并存）。
     * 若环境仍 CN:0，多为防火墙、运营商限制 BT、种子无存活 Peer。
     */
    const extraBtTrackers = [
      'udp://tracker.opentrackr.org:1337/announce',
      'udp://open.stealth.si:80/announce',
      'udp://tracker.torrent.eu.org:451/announce',
      'udp://open.demonii.com:1337/announce',
    ].join(',')

    /** @type {string[]} */
    let args = [
      '--dir',
      outputDir,
      '--seed-time=0',
      '--summary-interval=20',
      '--console-log-level=notice',
      `--bt-tracker=${extraBtTrackers}`,
      `--dht-file-path=${dhtState.dhtFile}`,
    ]

    if (magnetUri) {
      if (!/^magnet:/i.test(magnetUri)) throw new Error('INVALID_MAGNET')
      args.push(magnetUri)
    } else if (torrentFileUrl) {
      let fp
      try {
        fp = fileURLToPath(torrentFileUrl)
      } catch {
        throw new Error('INVALID_TORRENT_URL')
      }
      if (!fp.toLowerCase().endsWith('.torrent')) throw new Error('INVALID_TORRENT')
      try {
        await fs.promises.access(fp, fs.constants.R_OK)
      } catch {
        throw new Error('TORRENT_NOT_FOUND')
      }
      args.push(fp)
    } else {
      throw new Error('NO_BT_URI')
    }

    return new Promise((resolve, reject) => {
      const ent = { proc: /** @type {import('child_process').ChildProcess | null} */ (null), cancelled: false }
      activeByWcId.set(wc.id, ent)

      const proc = spawn(exe, args, {
        cwd: outputDir,
        env: { ...process.env },
        shell: false,
      })
      ent.proc = proc

      let dhtLogTail = ''
      let dhtInStreamDeleteTried = false
      /** 仅当运行中 unlink 失败（多为 Windows 占用）时为 true；在 close 再删，避免误删 aria2 正常退出后刚写好的表 */
      let dhtUnlinkRetryAfterExit = false
      const appendDhtLog = (buf) => {
        dhtLogTail = (dhtLogTail + buf.toString()).slice(-16000)
        if (dhtInStreamDeleteTried || !DHT_FAIL_RE.test(dhtLogTail)) return
        dhtInStreamDeleteTried = true
        try {
          clearDhtRoutingFileSync(dhtState.dir, dhtState.dhtFile)
        } catch {
          markPendingDhtClearSync(dhtState.dir)
          dhtUnlinkRetryAfterExit = true
        }
      }

      const send = (buf) => {
        appendDhtLog(buf)
        if (wc.isDestroyed()) return
        wc.send('bt:aria2-log', { chunk: buf.toString() })
      }
      proc.stdout?.on('data', send)
      proc.stderr?.on('data', send)

      let settled = false

      /**
       * @param {number | null} exitCode
       * @param {boolean} cancelled
       */
      const purgeDhtAfterChildReleased = (exitCode, cancelled) => {
        if (!dhtUnlinkRetryAfterExit) return
        /** 正常下完（0）时 aria2 已把内存 DHT 写回磁盘，勿删刚写好的文件 */
        if (exitCode === 0 && !cancelled) {
          try {
            const flag = path.join(dhtState.dir, '.dht-clear-next')
            if (fs.existsSync(flag)) fs.unlinkSync(flag)
          } catch {
            /* ignore */
          }
          return
        }
        try {
          clearDhtRoutingFileSync(dhtState.dir, dhtState.dhtFile)
          const flag = path.join(dhtState.dir, '.dht-clear-next')
          if (fs.existsSync(flag)) fs.unlinkSync(flag)
        } catch {
          /* 仍失败则保留 .dht-clear-next */
        }
      }

      proc.on('error', (err) => {
        if (!settled) {
          settled = true
          purgeDhtAfterChildReleased(-1, false)
          activeByWcId.delete(wc.id)
          reject(err)
        }
      })
      proc.on('close', (code) => {
        if (settled) return
        settled = true
        const wasCancelled = ent.cancelled
        /** Windows：运行中删 dht.dat 常 EPERM；退出后再试；成功完成任务则不删已写回的表 */
        purgeDhtAfterChildReleased(code, wasCancelled)
        activeByWcId.delete(wc.id)
        if (wasCancelled) {
          resolve({ ok: false, cancelled: true })
          return
        }
        if (code === 0) resolve({ ok: true })
        else reject(new Error(`ARIA2_EXIT_${code}`))
      })
    })
  })

  /**
   * 应用退出前调用：标记 BT 任务为取消并尽量温和结束 aria2，降低 DHT 路由表写坏概率。
   * @param {number} [timeoutPerProcMs=6000]
   */
  async function gracefulShutdownAllAria2(timeoutPerProcMs = 6000) {
    const list = [...activeByWcId.entries()]
    for (const [, ent] of list) {
      if (!ent?.proc) continue
      ent.cancelled = true
      await killAria2ChildGracefully(ent.proc, timeoutPerProcMs)
    }
  }

  return { gracefulShutdownAllAria2 }
}

module.exports = { registerAria2BtIpc }
