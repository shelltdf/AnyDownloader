import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const pkgPath = fileURLToPath(new URL('./package.json', import.meta.url))
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string }

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  /** Electron file:// 与相对路径分发 */
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version ?? '0.0.0'),
  },
  resolve: {
    /**
     * parse-torrent 在 decodeTorrentFile 内使用 path.join.apply；Vite 默认对 `path` 的浏览器垫片不含 join，
     * 会导致运行时「Cannot read properties of undefined (reading 'apply')」。
     */
    alias: {
      path: 'path-browserify',
    },
  },
})
