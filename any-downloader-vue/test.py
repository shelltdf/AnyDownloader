#!/usr/bin/env python3
"""冒烟：生产构建（类型检查 + Vite build）"""
import subprocess
import sys
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parent
    shell = sys.platform == "win32"
    cmd = "npm run build" if shell else ["npm", "run", "build"]
    code = subprocess.call(cmd, cwd=root, shell=shell)
    if code != 0:
        return code
    dist = root / "dist" / "index.html"
    if not dist.is_file():
        print("test: dist/index.html missing after build", file=sys.stderr)
        return 1
    print("test: ok (dist/index.html present)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
