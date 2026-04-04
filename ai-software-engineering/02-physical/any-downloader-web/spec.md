# any-downloader-web — 物理规格（单一事实来源：实现行为）

## 构建与产物

- **源码根**：仓库 `any-downloader-vue/`
- **构建**：`npm run build` → `any-downloader-vue/dist/`（静态 SPA）
- **开发**：`npm run dev`（Vite）

## 界面区域（与实现 DOM 映射）

| 区域 | 容器 id / 类 | 说明 |
|------|----------------|------|
| 标题条 | `#title-strip` | 产品名 + favicon |
| 菜单栏 | `#menu-bar` | 文件、编辑、语言、主题、窗口、帮助；**语言/主题**分项子菜单 |
| 工具栏 | `#toolbar` | URL 输入、添加、开始、暂停、删除 |
| 下载列表 | `#download-list` | 表格：地址、协议、进度条、状态 |
| 分割条 | `.splitter` | 调整列表与 Dock 区宽度 |
| Dock Area | `#dock-area` | `#dock-view`（内容）+ `#dock-button-bar`（右缘竖条） |
| 状态栏 | `#status-bar` | 摘要；**点击**打开 Log 模态（`<pre>` 纯文本 + 复制） |

## 协议检测

- 输入 `trim` → **`expandLegacyDownloadLink`**：循环尝试将 `thunder://`（Base64 内层 `AA…ZZ`）、`flashget://`（Base64 内层 `[FLASHGET]…[FLASHGET]` 或裸 HTTP）、`qqdl://`（Base64 内层 HTTP）展开为内层字符串，最多 4 层；失败则保持原串。
- 再按特殊前缀识别 `magnet:`、`ed2k://`、（仍未展开的）`thunder://` / `flashget://` / `qqdl://`、`data:` → 否则 `URL` 解析（失败则尝试前缀 `https://`）。
- `protocol` 枚举（与 `any-downloader-vue/src/utils/protocol.ts` 一致）：`https` | `http` | `ftp` | `ftps` | `sftp` | `magnet` | `ed2k` | `data` | `blob` | `ws` | `wss` | `file` | `thunder` | `flashget` | `qqdl` | `ipfs` | `ipns` | `rtsp` | `mms` | `unknown`（`unknown` 则拒绝添加）。**展开成功**且内层为 `http(s)` 时，任务协议为 `http`/`https`，而非专用链枚举值。

## 下载行为

| 协议 | 行为 |
|------|------|
| `http` / `https` / `blob` | `fetch` + `ReadableStream` 读入；若有 `Content-Length` 则进度与块图按字节比例更新；完成后 `Blob` + `<a download>` 触发保存 |
| `data:` | `fetch(dataUrl)` 解码为 `Blob` 并保存 |
| 其他 | 任务可入队；**开始**时置 `error`，提示需桌面壳/引擎（占位） |

- **暂停**：`AbortController.abort()`；再次**开始**重新拉取（初版不实现 Range 续传）。
- **CORS/网络失败**：状态 `error`，文案使用界面当前语言的 `errCors`。

## 块图（32 槽）

- `chunks[i]`：`floor(progress * 32)` 的前缀格为已完成色。

## 网络测速 Dock

- 默认请求 `https://httpbin.org/bytes/524288`（`cors`），根据耗时与字节数估算 Mbit/s；失败时展示错误信息。

## 主题与语言

- 主题：`system` | `light` | `dark`；`localStorage` 键 `any-downloader-theme`；`data-theme` 作用于 `documentElement`。
- 语言：`zh` | `en`；默认随 `navigator.language`。

## Log

- 模块级 `lines[]`；**复制全文**使用 `navigator.clipboard.writeText`。
