# 系统设计 — AnyDownloader Web

## 子系统

1. **Presentation**：Vue 组件树，事件上抛到 composables。
2. **Application**：`useDownloads` 管理任务 CRUD、选中项、开始/暂停/取消。
3. **Domain**：`detectProtocol(url)`、`DownloadTask` 状态（queued / running / paused / done / error）。
4. **Infrastructure**：HTTP 处理器（fetch）、日志服务（内存环形缓冲）。

## 与物理层对应

实现映射见 `02-physical/any-downloader-web/mapping.md`。

## 关键用例

- **添加任务**：校验非空 URL → 识别协议 → 入队 → 可选自动开始。
- **HTTP 下载**：HEAD/GET → 读 `Content-Length`（若有）→ 流式读字节 → 更新进度与分块位图 → Blob 触发保存。
