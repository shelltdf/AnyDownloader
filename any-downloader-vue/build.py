#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""构建 Vite 网页（dist/）与 Electron 套壳及安装包。

步骤 1：始终执行 ``npm run build``（类型检查 + Vite 产出 dist/）。

步骤 2：默认执行 ``electron-builder``，按**当前主机**尽可能生成多平台制品（受上游工具链限制）：

- **Windows 主机**：通常可生成 Windows NSIS 安装程序 + Linux（AppImage、deb）。
- **macOS 主机**：可生成 macOS DMG，并常可额外生成 Windows / Linux 包。
- **Linux 主机**：通常可生成 Linux 包与 Windows NSIS（视是否安装 Wine 等而定）。

**macOS 的 .dmg** 建议在 **macOS** 上构建；在 Windows 上单独加 ``--mac`` 往往会失败，属正常现象。

可选参数（可组合）：

- ``--web-only`` — 只构建网页，不运行 electron-builder。
- ``--electron-dir`` — 网页构建后仅 ``electron-builder --dir``（release/*-unpacked，无安装包）。
- ``--win`` — 只打 Windows NSIS。
- ``--linux`` — 只打 Linux AppImage + deb。
- ``--mac`` — 只打 macOS dmg（建议在 macOS 上执行）。

完整「三平台安装包矩阵」请在 CI 分别为 Windows / macOS / Linux runner 执行本脚本（或使用对应 ``--*`` 标志）。
"""
from __future__ import annotations

import platform
import subprocess
import sys
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parent
    shell = sys.platform == "win32"
    argv = sys.argv[1:]

    web = subprocess.call(
        "npm run build" if shell else ["npm", "run", "build"],
        cwd=str(root),
        shell=shell,
    )
    if web != 0:
        return web
    if not (root / "dist" / "index.html").is_file():
        print("build: dist/index.html missing", file=sys.stderr)
        return 1

    if "--web-only" in argv:
        print("build: web OK (--web-only, skip Electron)")
        return 0

    if "--electron-dir" in argv:
        return subprocess.call(
            "npm run electron:pack" if shell else ["npm", "run", "electron:pack"],
            cwd=str(root),
            shell=shell,
        )

    targets: list[str] = []
    if "--win" in argv:
        targets.extend(["--win", "nsis"])
    if "--linux" in argv:
        targets.extend(["--linux", "AppImage", "deb"])
    if "--mac" in argv:
        targets.extend(["--mac", "dmg"])

    if not targets:
        s = platform.system()
        if s == "Darwin":
            targets = ["--mac", "dmg", "--win", "nsis", "--linux", "AppImage", "deb"]
        elif s == "Windows":
            targets = ["--win", "nsis", "--linux", "AppImage", "deb"]
        else:
            targets = ["--linux", "AppImage", "deb", "--win", "nsis"]

    args = ["npx", "--yes", "electron-builder", *targets]
    print("build:", " ".join(args))
    return subprocess.call(args, cwd=str(root))


if __name__ == "__main__":
    sys.exit(main())
