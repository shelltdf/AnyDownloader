# AnyDownloader（Web）— 开发与维护

## 仓库结构

- **实现**：`any-downloader-vue/`（Vue 3 + Vite + TypeScript）
- **四阶段文档**：`ai-software-engineering/`
- **物理规格**：`ai-software-engineering/02-physical/any-downloader-web/spec.md`

## 命令

| 命令 | 说明 |
|------|------|
| `npm install` | 安装依赖 |
| `npm run dev` | 开发服务器 |
| `npm run build` | 类型检查 + 生产构建 |
| `npm run preview` | 预览构建产物 |

## 依赖

- **运行时**：`vue`（见根目录 `THIRD_PARTY_LICENSES.md`）
- **开发期**：Vite、`@vitejs/plugin-vue`、`typescript`、`vue-tsc` 等

## 扩展下载协议

1. 在 `src/utils/protocol.ts` 扩展识别与 `DetectedProtocol`。
2. 在 `src/composables/useDownloads.ts` 的 `startSelected` 分支接入真实处理器（或 IPC 到桌面端）。
3. 同步更新 `spec.md` 与 `00-concept/product-design.md` 中的能力边界表。

## 第三方测速端点

- 默认 `httpbin.org` 仅作演示；生产环境应替换为可控端点并评估可用性与隐私政策。
