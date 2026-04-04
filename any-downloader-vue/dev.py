#!/usr/bin/env python3
"""开发态：npm run dev（热重载）"""
import subprocess
import sys
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parent
    shell = sys.platform == "win32"
    cmd = "npm run dev" if shell else ["npm", "run", "dev"]
    return subprocess.call(cmd, cwd=root, shell=shell)


if __name__ == "__main__":
    sys.exit(main())
