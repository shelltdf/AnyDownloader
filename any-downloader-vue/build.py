#!/usr/bin/env python3
"""封装生产构建：npm run build"""
import subprocess
import sys


def main() -> int:
    root = __import__("pathlib").Path(__file__).resolve().parent
    shell = sys.platform == "win32"
    cmd = "npm run build" if shell else ["npm", "run", "build"]
    return subprocess.call(cmd, cwd=root, shell=shell)


if __name__ == "__main__":
    sys.exit(main())
