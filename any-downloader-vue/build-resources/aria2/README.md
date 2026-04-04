# 内置 aria2（Windows x64）

打包 **Electron 安装包**前，会在 `npm run electron:dist` / `electron:pack` 中自动执行 `scripts/fetch-aria2-win.cjs`，从 [aria2 官方 Release](https://github.com/aria2/aria2/releases) 下载 Windows 64 位构建并解压 **`aria2c.exe`** 到此目录。

- **许可证**：aria2 为 **GPL-2.0+**，随包附带 **`COPYING`**（由 fetch 脚本从发布包复制）。
- **手动拉取**（需网络）：在 `any-downloader-vue` 目录执行  
  `node scripts/fetch-aria2-win.cjs`
- **离线构建**：先将 `aria2c.exe`（及可选 `COPYING`）放入本目录后再执行 `electron-builder`。

未放置 `aria2c.exe` 时，桌面应用仍可使用环境变量 **`ARIA2_PATH`** 或系统 **PATH** 中的 `aria2c`。
