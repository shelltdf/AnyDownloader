#!/usr/bin/env python3
"""默认运行：npm run dev"""
import subprocess
import sys


def main() -> int:
    root = __import__("pathlib").Path(__file__).resolve().parent
    shell = sys.platform == "win32"
    cmd = "npm run dev" if shell else ["npm", "run", "dev"]
    return subprocess.call(cmd, cwd=root, shell=shell)


if __name__ == "__main__":
    sys.exit(main())
