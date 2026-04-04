# 第三方许可证汇总（运行时）

本文件列出**进入最终 Web 产物**的主要第三方依赖。开发-only 工具链未逐条展开。

## npm 生产依赖（`any-downloader-vue`）

| 包名 | 版本（约） | 许可证 | 说明 |
|------|------------|--------|------|
| vue | ^3.5.x | MIT | 运行时框架 |

 SPDX：`MIT`（以各包 `package.json` / 仓库 `LICENSE` 为准）。

## Electron 桌面套壳（构建期 / 打包进安装包）

以下在 **`npm install` 的 devDependencies** 中，但会进入 **electron-builder 打出的安装包/可执行文件**（Electron 运行时与 Chromium 等）：

| 组件 | 许可证（常见） | 说明 |
|------|----------------|------|
| electron | MIT | 桌面壳运行时 |
| electron-builder 打包产物内含 Chromium 等 | 见 Electron 与 Chromium 官方条款 | 由 electron-builder 随应用分发 |

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
