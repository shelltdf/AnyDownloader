#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
启动已打包的 Electron 桌面程序（``release/`` 下的免安装目录）。

默认会在以下情况**自动**执行 ``python build.py --electron-dir``
（``npm run build`` + ``electron-builder --dir``，生成 ``win-unpacked`` / ``linux-unpacked`` / ``*.app``）：

- 找不到可执行文件；
- **源码或配置比 ``dist/`` 新**（会先生成最新网页产物）；
- **``dist/index.html`` 比当前可执行文件新**（网页已构建但未重新打 Electron 目录包）。

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


def _sources_latest_mtime(root: Path) -> float:
    """与网页/Electron 相关的源码与配置的最新修改时间。"""
    mt = 0.0
    for sub in ("src", "electron"):
        d = root / sub
        if not d.is_dir():
            continue
        for p in d.rglob("*"):
            if not p.is_file():
                continue
            if "node_modules" in p.parts:
                continue
            try:
                mt = max(mt, p.stat().st_mtime)
            except OSError:
                pass
    pub = root / "public"
    if pub.is_dir():
        for p in pub.rglob("*"):
            if p.is_file():
                try:
                    mt = max(mt, p.stat().st_mtime)
                except OSError:
                    pass
    for name in ("package.json", "package-lock.json", "index.html"):
        f = root / name
        if f.is_file():
            try:
                mt = max(mt, f.stat().st_mtime)
            except OSError:
                pass
    for p in root.glob("vite.config.*"):
        if p.is_file():
            try:
                mt = max(mt, p.stat().st_mtime)
            except OSError:
                pass
    for p in root.glob("tsconfig*.json"):
        if p.is_file():
            try:
                mt = max(mt, p.stat().st_mtime)
            except OSError:
                pass
    icon_script = root / "scripts" / "gen-app-icon.cjs"
    if icon_script.is_file():
        try:
            mt = max(mt, icon_script.stat().st_mtime)
        except OSError:
            pass
    return mt


def _should_repack_electron(root: Path, exe: Optional[Path]) -> bool:
    """是否需要重新执行 build.py --electron-dir（生成最新 dist 并打 unpacked）。"""
    dist_html = root / "dist" / "index.html"
    src_mt = _sources_latest_mtime(root)
    if not dist_html.is_file():
        return True
    dist_mt = dist_html.stat().st_mtime
    if src_mt > dist_mt:
        return True
    if exe is None or not exe.is_file():
        return True
    try:
        exe_mt = exe.stat().st_mtime
    except OSError:
        return True
    if dist_mt > exe_mt:
        return True
    return False


def _print_repack_banner(artifact: Optional[Path], missing_msg: str) -> None:
    if artifact is None or not artifact.is_file():
        print(f"run: {missing_msg}", flush=True)
    else:
        print(
            "run: 检测到源码或 dist 已更新，正在执行 build.py --electron-dir…",
            flush=True,
        )


def main() -> int:
    root = Path(__file__).resolve().parent
    rel = root / "release"
    argv = sys.argv[1:]
    no_auto_build = "--no-build" in argv

    if sys.platform == "win32":
        exe = _find_win_exe(rel)
        if not no_auto_build and _should_repack_electron(root, exe):
            _print_repack_banner(
                exe,
                "未找到 AnyDownloader.exe，正在执行 build.py --electron-dir（首次较慢）…",
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
        if not no_auto_build and _should_repack_electron(root, app):
            _print_repack_banner(app, "未找到 AnyDownloader.app，正在执行 build.py --electron-dir…")
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
    if not no_auto_build and _should_repack_electron(root, binary):
        _print_repack_banner(
            binary,
            "未找到 linux-unpacked 可执行文件，正在执行 build.py --electron-dir…",
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
