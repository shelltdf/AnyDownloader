import { ref } from 'vue'

/** 使用公开端点估算下载吞吐（受 CORS 与网络影响） */
const TEST_URL = 'https://httpbin.org/bytes/524288'

const running = ref(false)
const lastMbps = ref<number | null>(null)
const lastError = ref<string | null>(null)

export function useSpeedTest() {
  async function run(): Promise<void> {
    running.value = true
    lastError.value = null
    lastMbps.value = null
    const t0 = performance.now()
    try {
      const res = await fetch(TEST_URL, { mode: 'cors' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = await res.arrayBuffer()
      const sec = (performance.now() - t0) / 1000
      const bits = buf.byteLength * 8
      lastMbps.value = sec > 0 ? bits / sec / 1e6 : null
    } catch (e) {
      lastError.value = (e as Error).message
      lastMbps.value = null
    } finally {
      running.value = false
    }
  }

  return { running, lastMbps, lastError, run }
}
