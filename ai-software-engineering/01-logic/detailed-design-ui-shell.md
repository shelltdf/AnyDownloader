# 详细设计 — 页内壳层与 Dock

## 布局树（逻辑）

- `#title-strip`：产品名。
- `#menu-bar`：`role="menubar"` 或语义化导航。
- `#toolbar`：命令按钮组。
- `#main-row`：`#download-list`（flex:1） + `#dock-area`。
- `#dock-area`：`#dock-view`（面板堆叠） + `#dock-button-bar`（右缘竖条按钮）。
- `#status-bar`：摘要 + 可点击打开 Log。

## Dock 按钮与视图正交

- 按钮仅切换对应面板在 `#dock-view` 内是否展开；按钮条宽度不随面板内容高度联动。

## Log

- 状态栏点击 → 模态/抽屉展示 `<pre>` 纯文本；**复制**写入剪贴板（`navigator.clipboard`）。

## 语言与主题

- **语言**：中文 / 英文，独立菜单项。
- **主题**：跟随系统 / 浅色 / 深色；跟随系统监听 `prefers-color-scheme`。

## 帮助

- **帮助信息**：F1 打开简短说明（可与关于同层或独立对话框）。
- **关于**：版本与简介。
