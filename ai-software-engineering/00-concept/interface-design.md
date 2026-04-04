# 接口设计（程序间）— AnyDownloader

> 本文件仅描述 **API / RPC / IPC** 等人机之外的契约；**不含** 菜单、快捷键、窗口等人机交互（见 `product-design.md`）。

## 当前阶段

- **不适用**对外 HTTP API。下载直接由浏览器向资源源站发起请求。

## 未来扩展（占位）

- **Electron IPC**：`download:start` / `download:progress` / `download:complete` 载荷形状在引入主进程后再于本文件细化。
- **本地代理**：`ws://127.0.0.1:any-downloader` 等需在落地时补充 OpenAPI/消息表。
