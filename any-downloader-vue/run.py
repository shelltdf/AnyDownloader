#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
启动已打包的 Electron 桌面程序（``release/`` 下的免安装目录）。

默认会在找不到可执行文件时**自动**执行 ``python build.py --electron-dir``
（网页构建 + ``electron-builder --dir``，生成 ``win-unpacked`` / ``linux-unpacked`` / ``*.app``）。

若不想隐式打包，使用 ``python run.py --no-build``，仅报错并提示手动命令。

手动打包（任选）：

- ``python build.py --electron-dir`` — 只要免安装目录，**供本脚本启动**（推荐）。
- ``python build.py`` — 完整安装包；部分环境下仍会留下 ``win-unpacked``，但不保证。
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Optional


def _electron_dir_pack(root: Path) -> int:
    """Run build.py --electron-dir (npm build + electron-builder --dir)."""
    return subprocess.call(
        [sys.executable, str(root / "build.py"), "--electron-dir"],
        cwd=str(root),
    )


def _find_win_exe(rel: Path) -> Optional[Path]:
    primary = rel / "win-unpacked" / "AnyDownloader.exe"
    if primary.is_file():
        return primary
    if rel.is_dir():
        for p in rel.rglob("AnyDownloader.exe"):
            if p.is_file() and "unpacked" in p.parts:
                return p
    return None


def _find_mac_app(rel: Path) -> Optional[Path]:
    best: Optional[Path] = None
    if rel.is_dir():
        for app in rel.rglob("AnyDownloader.app"):
            if app.is_dir():
                best = app
                break
    return best


def _find_linux_bin(lu: Path) -> Optional[Path]:
    if not lu.is_dir():
        return None
    for name in ("anydownloader", "AnyDownloader", "any-downloader-vue"):
        p = lu / name
        if p.is_file() and os.access(p, os.X_OK):
            return p
    for f in sorted(lu.iterdir()):
        if f.is_file() and os.access(f, os.X_OK) and not f.suffix:
            return f
    return None


def main() -> int:
    root = Path(__file__).resolve().parent
    rel = root / "release"
    argv = sys.argv[1:]
    no_auto_build = "--no-build" in argv

    if sys.platform == "win32":
        exe = _find_win_exe(rel)
        if exe is None and not no_auto_build:
            print(
                "run: 未找到 AnyDownloader.exe，正在执行 build.py --electron-dir（首次较慢）…",
                flush=True,
            )
            rc = _electron_dir_pack(root)
            if rc != 0:
                return rc
            exe = _find_win_exe(rel)
        if exe is not None:
            return subprocess.call([str(exe)], cwd=str(exe.parent))
        print(
            "未找到 release/**/AnyDownloader.exe。\n"
            "请在本目录执行: python build.py --electron-dir\n"
            "（完整安装包请用: python build.py）",
            file=sys.stderr,
        )
        return 1

    if sys.platform == "darwin":
        app = _find_mac_app(rel)
        if app is None and not no_auto_build:
            print(
                "run: 未找到 AnyDownloader.app，正在执行 build.py --electron-dir…",
                flush=True,
            )
            rc = _electron_dir_pack(root)
            if rc != 0:
                return rc
            app = _find_mac_app(rel)
        if app is not None:
            return subprocess.call(["open", "-n", "-a", str(app)])
        print(
            "未找到 release/**/AnyDownloader.app。请执行: python build.py --electron-dir",
            file=sys.stderr,
        )
        return 1

    # Linux
    lu = rel / "linux-unpacked"
    binary = _find_linux_bin(lu)
    if binary is None and not no_auto_build:
        print(
            "run: 未找到 linux-unpacked 可执行文件，正在执行 build.py --electron-dir…",
            flush=True,
        )
        rc = _electron_dir_pack(root)
        if rc != 0:
            return rc
        binary = _find_linux_bin(rel / "linux-unpacked")
    if binary is not None:
        return subprocess.call([str(binary)], cwd=str(binary.parent))
    print(
        "未找到 release/linux-unpacked 下可执行文件。请执行: python build.py --electron-dir",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
