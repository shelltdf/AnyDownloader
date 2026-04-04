#!/usr/bin/env python3
"""Web 端运行方式。

- 默认 ``python run_web.py``：监听源码变更并**持续生成最新 dist/**（``vite build --watch``）。
- ``python run_web.py --dev``：Vite 开发服务器（``npm run dev``，HMR，不落盘生产 dist）。

完整类型检查与单次生产构建请用 ``npm run build`` 或 ``python build.py --web-only``。
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parent
    shell = sys.platform == "win32"
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--dev",
        action="store_true",
        help="使用开发服务器（热更新），不执行持续生产构建",
    )
    args = ap.parse_args()
    if args.dev:
        cmd = "npm run dev" if shell else ["npm", "run", "dev"]
    else:
        cmd = "npm run build:watch" if shell else ["npm", "run", "build:watch"]
    return subprocess.call(cmd, cwd=str(root), shell=shell)


if __name__ == "__main__":
    sys.exit(main())
