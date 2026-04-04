# 详细设计 — 下载与协议

## 协议检测顺序

1. 规范化 `trim`；若无效则拒绝。
2. `new URL(input)`（失败则尝试补全 `https://` 再解析）。
3. `protocol` 小写匹配：`https:`、`http:`、`ftp:`、`ftps:`、`sftp:`、`magnet:`、`ed2k:`、`data:`。

## 状态机（单任务）

```
queued → running ⇄ paused → done
                    ↘ error
```

## HTTP 分块图

- 将 **0%–100%** 划分为固定槽位（如 32 格）；每收到一定字节比例则标记一格为「已完成」色，用于 **下载块图** Dock。

## 非 HTTP

- 任务可创建为 `queued`，`start` 时若处理器为占位，则置 `error` 或 `paused` 并写日志说明需桌面扩展。
