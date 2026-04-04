# 第三方许可证汇总（运行时）

本文件列出**进入最终 Web 产物**的主要第三方依赖。开发-only 工具链未逐条展开。

## npm 生产依赖（`any-downloader-vue`）

| 包名 | 版本（约） | 许可证 | 说明 |
|------|------------|--------|------|
| vue | ^3.5.x | MIT | 运行时框架 |
| path-browserify | ^1.0.x | MIT | Vite 打包时供 `parse-torrent` 使用 `path.join`（浏览器垫片） |
| parse-torrent | ^11.x | MIT | BT 元数据解析（与 path-browserify 同捆） |

 SPDX：`MIT`（以各包 `package.json` / 仓库 `LICENSE` 为准）。

## Electron 桌面套壳（构建期 / 打包进安装包）

以下在 **`npm install` 的 devDependencies** 中，但会进入 **electron-builder 打出的安装包/可执行文件**（Electron 运行时与 Chromium 等）：

| 组件 | 许可证（常见） | 说明 |
|------|----------------|------|
| electron | MIT | 桌面壳运行时 |
| electron-builder 打包产物内含 Chromium 等 | 见 Electron 与 Chromium 官方条款 | 由 electron-builder 随应用分发 |
| **aria2**（`aria2c.exe`，Windows 可选内置） | **GPL-2.0+** | 由 `any-downloader-vue/scripts/fetch-aria2-win.cjs` 自 [aria2 官方 Release](https://github.com/aria2/aria2/releases) 获取，置于 `build-resources/aria2/` 并经 `extraResources` 打入安装包 `resources/aria2/`；随包附带官方 **`COPYING`**。源码：<https://github.com/aria2/aria2> |
| **yt-dlp**（`yt-dlp.exe`，Windows 可选内置） | **Unlicense**（以官方为准） | 由 `any-downloader-vue/scripts/fetch-ytdlp-win.cjs` 自 [yt-dlp Releases](https://github.com/yt-dlp/yt-dlp/releases) 获取，置于 `build-resources/yt-dlp/` 并经 `extraResources` 打入 `resources/yt-dlp/`。源码：<https://github.com/yt-dlp/yt-dlp> |

开发依赖中的 `electron-builder`、`concurrently`、`wait-on`、`cross-env` 等**不进入**最终用户安装包（仅构建机使用）。以 `npm ls` / 各包 `LICENSE` 为准。

## 数字资产

| 资源 | 来源 | 许可证 |
|------|------|--------|
| `any-downloader-vue/public/favicon.svg` | 本仓库生成 | 与项目一致 |

## 复现

在 `any-downloader-vue/` 执行：

```bash
npm ls --omit=dev
```

以核对当前安装的**生产**依赖树。
