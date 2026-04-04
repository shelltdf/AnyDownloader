#!/usr/bin/env python3
"""发布最小路径：构建后将 dist/ 作为可拷贝分发目录（无签名/安装器）"""
import shutil
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
    dist = root / "dist"
    if not (dist / "index.html").is_file():
        print("publish: dist incomplete", file=sys.stderr)
        return 1
    out = root / "publish-out"
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(dist, out)
    print(f"publish: copied dist -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
