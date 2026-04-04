import { reactive, ref } from 'vue'
import { locale } from './useI18n'

export interface RegionRow {
  id: string
  label: string
  /** 至响应头返回的 HTTP 往返时间（毫秒），非 ICMP */
  pingMs: number | null
  pingError: string | null
  downloadMbps: number | null
  downloadError: string | null
}

/** 各区域下载测速 URL（均为公开资源；实际路由因 ISP 而异，标签为「参考节点」） */
const REGION_DEFS = [
  {
    id: 'bj',
    zh: '北京 / 华北（npmmirror）',
    en: 'Beijing (npmmirror)',
    url: 'https://registry.npmmirror.com/lodash/-/lodash-4.17.21.tgz',
  },
  {
    id: 'sh',
    zh: '上海 / 华东（npmmirror）',
    en: 'Shanghai (npmmirror)',
    url: 'https://registry.npmmirror.com/axios/-/axios-1.6.8.tgz',
  },
  {
    id: 'hk',
    zh: '香港 / 亚太（jsDelivr）',
    en: 'Hong Kong (jsDelivr)',
    url: 'https://cdn.jsdelivr.net/npm/vue@3.5.13/dist/vue.runtime.global.prod.js',
  },
  {
    id: 'jp',
    zh: '日本 / 东亚（npm registry）',
    en: 'Japan (npm)',
    url: 'https://registry.npmjs.org/typescript/-/typescript-5.4.5.tgz',
  },
  {
    id: 'us',
    zh: '美国（httpbin）',
    en: 'USA (httpbin)',
    url: 'https://httpbin.org/bytes/786432',
  },
  {
    id: 'eu',
    zh: '欧洲（参考 jsDelivr）',
    en: 'Europe (jsDelivr ref.)',
    // Hetzner 等专线在部分网络易超时，改用 CDN 静态资源作吞吐参考
    url: 'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.min.js',
  },
] as const

const running = ref(false)
const uploadMbps = ref<number | null>(null)
const uploadError = ref<string | null>(null)
const lastError = ref<string | null>(null)

const regions = reactive<RegionRow[]>(
  REGION_DEFS.map((d) => ({
    id: d.id,
    label: '',
    pingMs: null,
    pingError: null,
    downloadMbps: null,
    downloadError: null,
  })),
)

function setRegionLabels(locale: 'zh' | 'en') {
  REGION_DEFS.forEach((d, i) => {
    regions[i].label = locale === 'zh' ? d.zh : d.en
  })
}

/** 浏览器内对该 URL 的 HTTP 请求至收到响应头的耗时（近似 ping，非 ICMP） */
async function measureHttpPingMs(url: string): Promise<{ ms: number | null; err: string | null }> {
  const t0 = performance.now()
  const ac = new AbortController()
  const tid = window.setTimeout(() => ac.abort(), 15000)
  try {
    const res = await fetch(url, { mode: 'cors', cache: 'no-store', signal: ac.signal })
    clearTimeout(tid)
    const ms = Math.round(performance.now() - t0)
    try {
      await res.body?.cancel()
    } catch {
      /* ignore cancel errors */
    }
    if (!res.ok) return { ms: null, err: `HTTP ${res.status}` }
    return { ms, err: null }
  } catch (e) {
    clearTimeout(tid)
    const err = e as Error
    const msg =
      err.name === 'AbortError' ? (locale.value === 'zh' ? '超时' : 'timeout') : err.message
    return { ms: null, err: msg }
  }
}

async function measureDownloadMbps(url: string): Promise<{ mbps: number | null; err: string | null }> {
  const t0 = performance.now()
  try {
    const res = await fetch(url, { mode: 'cors', cache: 'no-store' })
    if (!res.ok) return { mbps: null, err: `HTTP ${res.status}` }
    const buf = await res.arrayBuffer()
    const sec = (performance.now() - t0) / 1000
    const bits = buf.byteLength * 8
    return { mbps: sec > 0 ? bits / sec / 1e6 : null, err: null }
  } catch (e) {
    return { mbps: null, err: (e as Error).message }
  }
}

const UPLOAD_URL = 'https://httpbin.org/post'
const UPLOAD_BYTES = 768 * 1024

async function measureUploadMbps(): Promise<{ mbps: number | null; err: string | null }> {
  const body = new Uint8Array(UPLOAD_BYTES)
  crypto.getRandomValues(body)
  const t0 = performance.now()
  try {
    const res = await fetch(UPLOAD_URL, {
      method: 'POST',
      mode: 'cors',
      body,
    })
    if (!res.ok) return { mbps: null, err: `HTTP ${res.status}` }
    await res.arrayBuffer()
    const sec = (performance.now() - t0) / 1000
    const bits = UPLOAD_BYTES * 8
    return { mbps: sec > 0 ? bits / sec / 1e6 : null, err: null }
  } catch (e) {
    return { mbps: null, err: (e as Error).message }
  }
}

export function useSpeedTest() {
  async function runAll(locale: 'zh' | 'en'): Promise<void> {
    setRegionLabels(locale)
    running.value = true
    lastError.value = null
    uploadError.value = null
    uploadMbps.value = null
    regions.forEach((r) => {
      r.pingMs = null
      r.pingError = null
      r.downloadMbps = null
      r.downloadError = null
    })

    try {
      for (let i = 0; i < REGION_DEFS.length; i++) {
        const url = REGION_DEFS[i].url
        const ping = await measureHttpPingMs(url)
        regions[i].pingMs = ping.ms
        regions[i].pingError = ping.err
        const { mbps, err } = await measureDownloadMbps(url)
        regions[i].downloadMbps = mbps
        regions[i].downloadError = err
      }

      const up = await measureUploadMbps()
      uploadMbps.value = up.mbps
      uploadError.value = up.err
    } catch (e) {
      lastError.value = (e as Error).message
    } finally {
      running.value = false
    }
  }

  return {
    running,
    regions,
    uploadMbps,
    uploadError,
    lastError,
    runAll,
    setRegionLabels,
  }
}
