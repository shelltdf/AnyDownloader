#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
启动已打包的 Electron 桌面程序（需先执行 build.py 或 ``npm run electron:pack`` 生成 release/）。

优先启动免安装目录内的可执行文件（与 electron-builder --dir 或完整打包后的 *-unpacked 一致）。
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parent
    rel = root / "release"

    if sys.platform == "win32":
        exe = rel / "win-unpacked" / "AnyDownloader.exe"
        if exe.is_file():
            return subprocess.call([str(exe)], cwd=str(exe.parent))
        print(
            "未找到 release/win-unpacked/AnyDownloader.exe。请先执行: python build.py",
            file=sys.stderr,
        )
        return 1

    if sys.platform == "darwin":
        for app in rel.rglob("AnyDownloader.app"):
            if app.is_dir():
                return subprocess.call(["open", "-n", "-a", str(app)])
        print(
            "未找到 release/**/AnyDownloader.app。请在 macOS 上执行 python build.py 生成套壳。",
            file=sys.stderr,
        )
        return 1

    # Linux
    lu = rel / "linux-unpacked"
    if lu.is_dir():
        for name in ("anydownloader", "AnyDownloader", "any-downloader-vue"):
            p = lu / name
            if p.is_file() and os.access(p, os.X_OK):
                return subprocess.call([str(p)], cwd=str(lu))
        for f in sorted(lu.iterdir()):
            if f.is_file() and os.access(f, os.X_OK) and not f.suffix:
                return subprocess.call([str(f)], cwd=str(lu))
    print(
        "未找到 release/linux-unpacked 下可执行文件。请先执行: python build.py",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
