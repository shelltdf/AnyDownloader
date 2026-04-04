# any-downloader-web — 物理规格（单一事实来源：实现行为）

## 构建与产物

- **源码根**：仓库 `any-downloader-vue/`
- **构建**：`npm run build` → `any-downloader-vue/dist/`（静态 SPA）
- **开发**：`npm run dev`（Vite）

## Electron 套壳专有：视频下载（yt-dlp）

- **网页版（纯 Vite SPA）**：不提供视频页下载；无 `window.anyDownloaderShell` 时不展示「视频下载」菜单与 🎬 工具栏按钮。
- **Electron**：`electron/video-ytdlp.cjs` 注册 IPC；`preload.cjs` 暴露 `checkYtdlp`、`pickVideoOutputDir`、`startVideoDownload`、`cancelVideoDownload`、`onVideoYtdlpLog`。
- **依赖**：解析顺序 **`YT_DLP_PATH`** → **Windows 安装包内置** `resources/yt-dlp/yt-dlp.exe`（构建前 `node scripts/fetch-ytdlp-win.cjs`，Unlicense）→ 本机 **`yt-dlp` / `yt-dlp.exe`** 或 **`python -m yt_dlp`** 等。
- **UI**：`App.vue` 在 `isElectron` 时提供「文件 → 视频下载（yt-dlp）…」与工具栏 🎬；弹窗内选目录、填 http(s) URL、查看 yt-dlp 文本输出、开始/取消。

## Electron 套壳专有：磁力 / 本地 .torrent（aria2c）

- **`electron/aria2-bt.cjs`** 注册 IPC：`bt:check-aria2`、`bt:start`、`bt:cancel`；日志经 `bt:aria2-log` 推送到渲染进程。
- **preload**：`checkAria2`、`startAria2Job`、`cancelAria2Job`、`onAria2Log`。
- **依赖**：**Windows 安装包**可内置 `resources/aria2/aria2c.exe`（构建前 `node scripts/fetch-aria2-win.cjs`，GPL-2.0+，见同目录 `COPYING`）；否则本机 PATH 中的 **`aria2c`** / **`aria2c.exe`**，或环境变量 **`ARIA2_PATH`**。
- **行为**：`magnet:` 与 **`file:` 且路径名以 `.torrent` 结尾** 的任务在 **`electronOutputDir`** 下由 aria2 拉取；暂停调用 `cancelAria2Job`（杀子进程）。**自网站下载的 `.torrent` 文件**仍按普通 `http(s)` 直链处理。主进程为增强 Peer 发现，会附加公共 `--bt-tracker`（与磁力自带 Tracker、DHT 并存）；若日志长期 **CN:0 / DL:0B**，多为网络防火墙、运营商限制 BT、或种子无存活 Peer，非 UI 单独可解。
- **aria2 输出与「服务器通讯」**：`--summary-interval=20`（秒）降低周期汇总频率；渲染进程 `useDownloads` 对 stderr 行做 **ANSI 剥离**、**分隔线省略**、**相同进度行 / 相同 FILE 行 / Download Progress Summary 块** 的时间窗去重，避免刷屏（内容变化时仍会立刻记录）。

## Electron 套壳专有：添加 BT 种子（解析弹窗）

- **UI**：`isElectron` 时「文件 → 添加 BT 种子…」与工具栏 🧲；弹窗内 **`shell:pick-torrent-file`**（`electron/main.cjs`）读取本地 `.torrent` 与 **`file:` URL**，渲染进程用 **`parse-torrent`**（`parseTorrentMeta.ts`）解析元数据；**`pickImportDirectory`** 选择 **`electronOutputDir`**；**立即下载** / **加入队列** 分别调用 `enqueueTask` + 可选 `startTask`，任务协议为 **`file:` + 路径以 `.torrent` 结尾**，与批量添加中的 BT 行一致。

## Electron 套壳：系统标题栏 / 顶层菜单与页内 UI 的关系

- **页内**：`#title-strip`、`#menu-bar`、`#toolbar` 在 Electron 下**始终渲染**（与浏览器版同一套界面），不因「是否显示系统壳」而隐藏。
- **无边框（默认）**：`BrowserWindow` 使用 `frame: false`，无系统应用菜单；页内标题条右侧保留最小化/最大化/关闭；标题条与工具栏**右键**弹出主进程 **`Menu`（勾选「显示系统标题栏与菜单栏」）**，勾选后主进程切换 `frame: true` 并设置 `Menu.setApplicationMenu`（文件/编辑/视图/窗口等），**重建窗口**（须**先 `instantiateWindow` 再 `destroy` 旧窗**，避免瞬间 0 窗口触发 `window-all-closed` → `app.quit`）；偏好写入 `userData/any-downloader-window.json`。
- **系统壳开启时**：隐藏页内窗口控制按钮（避免与系统标题栏重复）；页内标题条拖拽区改为 `no-drag`，以免与原生标题栏冲突。
- **preload**：`getUseNativeChrome`、`setUseNativeChrome`、`popupShellChromeMenu`（传入 `clientX`/`clientY` 与文案键）。

## Electron 图标（与页内 favicon 统一）

- **`build-resources/icon.png`**：与 `public/favicon.svg` 同主色与箭头造型（圆角方块），由 **`scripts/gen-app-icon.cjs`** 生成；**`npm run prebuild`**（随 `npm run build`）会重新生成。
- **`electron/main.cjs`**：`BrowserWindow` 使用 **`nativeImage.createFromPath(build-resources/icon.png)`**，窗口与 **Windows 任务栏**使用同一图标；**`package.json` → `build.icon`** 指向同文件，供 **electron-builder** 嵌入可执行文件图标。
- 打包 **`files`** 须包含 **`build-resources/icon.png`**，以便 asar 内主进程可解析路径。

## 任务列表跨会话持久化

- **`localStorage` 键 `any-downloader-task-list-v1`**：`useDownloads.ts` 将列表中**全部**任务（含排队、暂停、进行中、完成、错误）序列化保存；仅当用户 **删除任务**、**全部删除**或 **清理完成** 时从列表移除并写回。刷新、关窗、重启应用后自动加载。
- **恢复规则**：从存储读出时，原状态为 **`running` 的改为 `paused`**，避免关窗瞬间未暂停的假「下载中」；用户可再次点「开始」续下。
- **多连接 HTTP 续传**：仍依赖 **`downloadIdb`**（按任务 **id**）；运行中约 **2.2s** 周期 **`persistParts`**，与暂停时落库配合，减少关窗导致分片未写入的损失。
- **`FileSystemFileHandle`** 无法 JSON 持久化，恢复后 **`saveHandle` 为 `null`**；完成写盘时走既有 **`createWritable` / `<a download>`** 回退逻辑。

## 界面区域（与实现 DOM 映射）

| 区域 | 容器 id / 类 | 说明 |
|------|----------------|------|
| 标题条 | `#title-strip` | 产品名 + favicon |
| 菜单栏 | `#menu-bar` | 文件、编辑、语言、主题、窗口、帮助；**帮助**含「下载方式」弹窗入口 |
| 工具栏 | `#toolbar` | URL 输入；其余为**仅图标**按钮（`aria-label` / `title` 承载文案）：添加、队列、网页提取、**Electron 时** 🎬 视频下载、全部开始/暂停/删除、清理完成 |
| 下载列表 | `#download-list` | 表格；**右键**：开始、暂停、**重新开始**、删除、复制链接 |
| 分割条 | `.splitter-left` / `.splitter-right` | 分别调整左、右侧 Dock 与列表宽度 |
| 左侧 Dock | `#dock-area-left` | **网络测速**（默认**折叠**，仅展开「全局状态」）；**全局状态**（总速度、曲线+实时值、写入曲线、**并行任务数**自动/手动、**最大并行任务** 1–16 默认 2、**下载压力**最小/适中/最大、多连接设置） |
| 右侧 Dock | `#dock-area-right` | **下载信息**：**已下载 / 总大小 / 速度**同一行；`bytesReceivedForDisplay` 展示不超过总长；单连接原因、每任务连接覆盖、速度曲线。 **块图**：`active` / **`paused`**（暂停后仍显示格内饼形进度） |
| 状态栏 | `#status-bar` | 摘要 + 全局连接策略摘要；**点击**打开 Log |

## 保存位置

- **添加入队前**须完成保存目标：`showSaveFilePicker`（支持时）或 `prompt` 回退文件名；任务携带 `saveFileName` 与可选 `FileSystemFileHandle`。
- **从网页批量添加**：获取链接时展示加载提示；**全选可见 / 清除可见**单独成行。**浏览器**：`showDirectoryPicker` + **`getOrCreateFileHandleInDirectory`**（`saveFileName` 可含子路径）；**Electron**：`shell:pick-import-dir` 展示完整路径，`enqueueTask` 带 `electronOutputDir`，完成写盘走 `shell:write-import-file`。
- **批量「保留相对路径」**：多条 **同 origin** 的 `http(s)` 且存在**公共路径目录前缀**时，可将 URL 中该前缀之后的子路径（经 `sanitizeRelativeSavePath`）映射到保存目录下的子文件夹；规则实现见 `urlBatchRelativePath.ts`。添加弹窗与网页导入均提供可选勾选。
- **磁力 / 本地种子与 HTTP 混选**：须 **Electron**；统一 **`pickImportDirectory`** 得到 `electronOutputDir`，HTTP 任务仍由渲染进程拉取后经 **`write-import-file`** 落盘。
- **`shell:write-import-file`**：`fileName` 支持相对子路径（段内净化）；`mkdir` **recursive**；默认 **`atomic !== false`** 时先写 **`目标名.part`** 再 **`rename`** 为最终名，失败则尝试删除 `.part`。

## 协议检测

- 输入 `trim` → **`expandLegacyDownloadLink`**（迅雷/快车/QQ 旋风等）→ 再按前缀 / `URL` 解析（与 `protocol.ts` 一致）。

## 下载行为

| 协议 | 行为 |
|------|------|
| `http` / `https` / `blob` | **自动优先多连接**：**HEAD** + **Range bytes=0-0** 验证 **206**；通过且已知总长则 **N 连接并行**；否则 **单流**，并在任务上记录 `singleConnReason`（`unknown_size` / `range_not_accepted` / `parallel_no_range`）及全局 `sessionDownloadInfo.bottleneck` 供界面展示。**运行中** `clampProgress` 对已知总长任务 **progress ≤ 0.99**，列表百分比 **未完成前最高显示 99%**，避免与「正在保存」混淆。`N`：**自动** 2–10 或**手动** 1–16（`useDownloadThreads.ts`）；**续传**时 `N` 以 IndexedDB `partCount` 为准。并行中若分片收到 **200** 则清空分片、**单连接重拉**并记 `parallel_no_range`。IndexedDB 仅存每片已写字节。暂停后 `finally` 钳制进度并刷新块图。合并/写盘前：`speedBps = 0`；**速度曲线**在 `isWriting` 时不采样；**每次开始下载**清空 `speedHistory`；瞬时速度用 **EMA** 平滑减轻暂停恢复尖峰。写盘耗时写入 **`sessionIoStats.writeBps`**（浏览器无系统级磁盘曲线，仅为应用测量）。落盘：**`createWritable()`** 或 `<a download>`；Electron 目录写盘见上 **`.part` + rename** |
| `data:` | `fetch` → `Blob` → 同上落盘 |
| `magnet:` | **Electron** 且已装 **aria2c**：`startAria2Job`；否则 **开始**时 `error`（`errNeedBackend` / `errAria2Missing`） |
| `file:` + `*.torrent` | **Electron** + **aria2c**：同上；**网页**不可入队为可开始任务 |
| 其他 | 可入队；**开始**时 `error` + `errNeedBackend` |

- **暂停**：`AbortController.abort()`；暂停前将分片进度写入 **IndexedDB**（`downloadIdb.ts`，库名 `any-downloader-resume-v1`）。
- **断点续传**：再次**开始**同一任务时自 IDB 合并已填充分片，对未完成区间继续 `Range` 请求（需 URL/总长仍一致）。
- **错误后重试**：`error` 状态再次开始会清空进度并删除该任务 IDB 记录后重拉。
- **CORS/网络失败**：`error` + `errCors`（或具体消息）。

## 块图（32 槽）

- `chunkSlots[i]`：`pending` | `active` | `done`；`chunkFill[i]` ∈ [0,1] 表示该格内字节完成比例（多分片按区间与 `filled` 计算；单流按连续字节比例）。
- **传输中**格用 **conic-gradient** 自 12 点钟方向顺时针绘制饼形（`--chunk-fill`）。

## 速度曲线

- **单任务**：采样写入 `speedHistory`；**SVG polyline** + 文案展示**当前瞬时速度**（`speedBps`）。
- **全局总速度**：约 300ms 采样 `aggregateSpeedBps`，保留约 80 点；**polyline** + 当前总速文案。
- **应用写入**：同源定时器采样 `sessionIoStats.writeBps` 并做衰减，**polyline**（异色）+ 当前写入速文案；反映 `writeFinalBlob` / `persistParts` 等耗时推算，**非**操作系统磁盘读曲线。

## 任务模型（列表展示相关字段）

- `runStartedAt`：本次任务首次开始下载的时间戳（ms）；暂停续传**不重置**（内部元数据）。列表「**已用**」展示 **`elapsedActiveMs` + 当前 running 段**（`taskActiveElapsedMs`）：**排队与暂停期间不计入**；完成/失败且旧数据无 `elapsedActiveMs` 时回退为 `runFinishedAt - runStartedAt`。
- `activeConnections`：`running` 时当前 HTTP 并行连接数；合并/写盘阶段为 0。
- `isWriting`：数据已在内存合并完毕、正在写入最终文件时为 `true`；列表状态文案显示「正在保存」类，与「下载中」区分。
- `singleConnReason`：并行成功为 `none`；否则为单连接原因键，与下载信息 Dock 中文案一致。

## 网络测速 Dock

- **分区域下载**：依次对固定 URL 列表（北京/上海 npmmirror、香港/日本 CDN 或 npm、美国 httpbin、欧洲 jsDelivr 等）做 `GET` + `arrayBuffer`，算 Mbit/s；失败单元格展示错误文案（多为 CORS 或网络）。
- **上传**：向 `https://httpbin.org/post` **POST ~768KiB** 随机体一次，算上传 Mbit/s；与区域节点不同，界面文案注明「参考」。

## 帮助「下载方式」

- 静态分组数据：`src/data/downloadMethodCatalog.ts`，按协议分类说明 + **测试 URL** 列（可为空）。

## 主题与语言

- 主题：`system` | `light` | `dark`；`localStorage` 键 `any-downloader-theme`；`data-theme` 作用于 `documentElement`。
- 语言：`zh` | `en`；默认随 `navigator.language`。

## Log

- 模块级 `lines[]`；**复制全文**使用 `navigator.clipboard.writeText`。
