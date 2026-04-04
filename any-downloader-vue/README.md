# AnyDownloader（Vue + 可选 Electron）

## 脚本入口（Python）

| 脚本 | 说明 |
|------|------|
| `run_web.py` | 启动 Vite 开发服务器（`npm run dev`） |
| `dev.py` | 同上（历史别名，与 `run_web.py` 等价） |
| `run.py` | 启动已打包的 Electron 程序（依赖 `release/` 下产物） |
| `build.py` | `npm run build` + `electron-builder`（网页 + 套壳与安装包，见下文） |
| `test.py` | 冒烟：仅执行网页生产构建并检查 `dist/index.html` |
| `publish.py` | 构建后将 `dist/` 复制到 `publish-out/`（纯网页分发） |

## Web 开发

```bash
npm install
python run_web.py
# 或
npm run dev
```

## Electron 套壳开发（热重载）

需两个进程合一：

```bash
npm install
npm run electron:dev
```

（`concurrently` 会拉起 Vite，待 5173 就绪后以 `ELECTRON_DEV=1` 启动 Electron。）

## 构建

### 网页 + 套壳与安装包（默认）

```bash
npm install
python build.py
```

- 先产出 `dist/`（`base: './'`，兼容 `file://`）。
- 再调用 `electron-builder`；**默认目标随当前操作系统变化**（见 `build.py` 文档字符串）。
- 产物目录：`release/`（如 NSIS `.exe`、`.AppImage`、`.deb`、`.dmg`、以及 `*-unpacked`）。

仅网页、不要 Electron：

```bash
python build.py --web-only
```

仅生成可运行目录、不要安装包：

```bash
python build.py --electron-dir
```

只打某一平台（可组合）：

```bash
python build.py --win
python build.py --linux
python build.py --mac
```

### 图标与安装器品牌

可在 `build-resources/` 放置 `icon.ico`（Windows）、`icon.icns`（macOS）、`icon.png`（Linux），并在 `package.json` 的 `build` 节配置 `icon`（参见 [electron-builder](https://www.electron.build/) 文档）。

### Windows：内置 aria2（BT / 磁力）

打 **Windows 安装包**（`--win` 或默认包含 NSIS）时，会先执行 `node scripts/fetch-aria2-win.cjs`，从 [aria2 官方 Release](https://github.com/aria2/aria2/releases) 拉取 **64 位 `aria2c.exe`** 到 `build-resources/aria2/`，再随安装包释放到 `resources/aria2/`（GPL-2.0+，同目录含 `COPYING`）。也可手动执行 `npm run fetch:aria2`。

仅打 Linux/mac 且未包含 Windows 目标时**不会**下载 aria2。

### Windows：内置 yt-dlp（视频下载）

打 **Windows 安装包**且目标包含 `--win` 时，会执行 `node scripts/fetch-ytdlp-win.cjs`，从 [yt-dlp Releases](https://github.com/yt-dlp/yt-dlp/releases) 拉取 **`yt-dlp.exe`** 到 `build-resources/yt-dlp/`，再随安装包释放到 `resources/yt-dlp/`（Unlicense，以官方为准）。也可手动执行 `npm run fetch:ytdlp`。

### Windows：未签名构建与 `winCodeSign`

`package.json` 中 `build.win.signAndEditExecutable` 默认为 **`false`**，避免 electron-builder 在修改 exe 资源时从 GitHub 拉取 `winCodeSign` 工具（在部分网络/TLS 环境下会失败）。**正式发布**若需 Authenticode 签名或必须写入版本资源，可改为 `true` 并配置证书（`CSC_LINK` / `CSC_KEY_PASSWORD` 等），并保证构建机能访问上述下载。

## 运行已打包桌面程序

在成功执行 `python build.py` 或 `npm run electron:pack` 后：

```bash
python run.py
```

## 技术说明

- **主进程**：`electron/main.cjs`（CommonJS，`package.json` 的 `"main"` 指向它）。
- **跨平台安装包**：受 Electron 与签名策略限制，**macOS DMG 建议在 macOS 上构建**；在 Windows 上默认不会成功生成 `.dmg`，可在 CI 用 macOS runner 补全。
