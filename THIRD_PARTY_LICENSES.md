# 第三方许可证汇总（运行时）

本文件列出**进入最终 Web 产物**的主要第三方依赖。开发-only 工具链未逐条展开。

## npm 生产依赖（`any-downloader-vue`）

| 包名 | 版本（约） | 许可证 | 说明 |
|------|------------|--------|------|
| vue | ^3.5.x | MIT | 运行时框架 |

 SPDX：`MIT`（以各包 `package.json` / 仓库 `LICENSE` 为准）。

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
