# 软件设计 — AnyDownloader Web

## 模块

- **UI Shell**：标题条、菜单栏、工具栏、主行（列表 + Dock）、状态栏、Log 弹层。
- **Protocol Router**：输入 URL → 协议枚举 → 对应 `DownloadHandler`。
- **Download Engine（浏览器）**：HTTP(S) 使用 `fetch` + `ReadableStream` 更新进度与分块图；其余协议占位并写日志。
- **i18n / Theme**：轻量响应式文案与 `data-theme` + `prefers-color-scheme`。

## 技术栈

- Vue 3 + TypeScript + Vite。
- 实现目录：`any-downloader-vue/`（与 `ai-software-engineering/` 分离）。

## 依赖关系

```
UI → useDownloads → protocol → handlers
                 → logger → LogModal ← StatusBar
```
