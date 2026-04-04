# any-downloader-web — 物理规格（单一事实来源：实现行为）

## 构建与产物

- **源码根**：仓库 `any-downloader-vue/`
- **构建**：`npm run build` → `any-downloader-vue/dist/`（静态 SPA）
- **开发**：`npm run dev`（Vite）

## 界面区域（与实现 DOM 映射）

| 区域 | 容器 id / 类 | 说明 |
|------|----------------|------|
| 标题条 | `#title-strip` | 产品名 + favicon |
| 菜单栏 | `#menu-bar` | 文件、编辑、语言、主题、窗口、帮助；**帮助**含「下载方式」弹窗入口 |
| 工具栏 | `#toolbar` | URL 输入、添加任务、**添加队列**、**从网页提取**、开始/暂停/删除 |
| 下载列表 | `#download-list` | 表格；**右键**任务行打开上下文菜单（开始/暂停/删除/复制链接） |
| 分割条 | `.splitter` | 调整列表与 Dock 区宽度 |
| Dock Area | `#dock-area` | 下载信息（**速度曲线** SVG）、**分区域测速表** + 上传一行、**块图**（三色槽位） |
| 状态栏 | `#status-bar` | 摘要；**点击**打开 Log 模态（`<pre>` 纯文本 + 复制） |

## 保存位置

- **添加入队前**须完成保存目标：`showSaveFilePicker`（支持时）或 `prompt` 回退文件名；任务携带 `saveFileName` 与可选 `FileSystemFileHandle`。
- **从网页批量添加**：`showDirectoryPicker` 选择目录后，对每个选中链接 `getFileHandle(name, { create: true })` 与任务绑定。

## 协议检测

- 输入 `trim` → **`expandLegacyDownloadLink`**（迅雷/快车/QQ 旋风等）→ 再按前缀 / `URL` 解析（与 `protocol.ts` 一致）。

## 下载行为

| 协议 | 行为 |
|------|------|
| `http` / `https` / `blob` | **HEAD** / **Range 0-0** 探测 `Content-Length` 与 `Accept-Ranges`；支持则 **6 路并行 Range** 写入分片缓冲，否则 **单流** `ReadableStream`。完成时 **`FileSystemFileHandle.createWritable()`** 或 `<a download>` |
| `data:` | `fetch` → `Blob` → 同上落盘 |
| 其他 | 可入队；**开始**时 `error` + `errNeedBackend` |

- **暂停**：`AbortController.abort()`；暂停前将分片进度写入 **IndexedDB**（`downloadIdb.ts`，库名 `any-downloader-resume-v1`）。
- **断点续传**：再次**开始**同一任务时自 IDB 合并已填充分片，对未完成区间继续 `Range` 请求（需 URL/总长仍一致）。
- **错误后重试**：`error` 状态再次开始会清空进度并删除该任务 IDB 记录后重拉。
- **CORS/网络失败**：`error` + `errCors`（或具体消息）。

## 块图（32 槽）

- `chunkSlots[i]`：`pending` | `active` | `done`（多段下载时按分片字节区间与 `filled` 计算覆盖；单流时按已收字节比例）。

## 速度曲线

- 运行中按固定间隔采样 `speedBps` 写入 `speedHistory`（有上限），下载信息 Dock 内 **SVG polyline** 展示。

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
