/** 帮助「下载方式」弹窗：按协议分类的说明与可测地址（受 CORS/网络影响） */

export type CatalogLocale = 'zh' | 'en'

export interface CatalogRow {
  protocol: string
  how: Record<CatalogLocale, string>
  testUrl: string
}

export const DOWNLOAD_METHOD_GROUPS: { title: Record<CatalogLocale, string>; rows: CatalogRow[] }[] = [
  {
    title: { zh: '浏览器内可直接拉取', en: 'Works in browser (fetch)' },
    rows: [
      {
        protocol: 'HTTP / HTTPS',
        how: {
          zh: '输入完整 URL；支持多连接 Range 与断点续传（IndexedDB）。需目标站允许 CORS。',
          en: 'Full URL; multi-connection Range + resume (IndexedDB). Requires CORS.',
        },
        testUrl: 'https://httpbin.org/bytes/1048576',
      },
      {
        protocol: 'data:',
        how: { zh: '内嵌 Base64 数据，直接解码保存。', en: 'Inline Base64; decode and save.' },
        testUrl: 'data:text/plain;charset=utf-8,hello-any-downloader',
      },
      {
        protocol: 'blob:',
        how: { zh: '同源 Blob URL（多为页面内生成）。', en: 'Same-origin blob URL.' },
        testUrl: '',
      },
    ],
  },
  {
    title: { zh: '专用链（自动展开为 HTTP）', en: 'Legacy links (decoded to HTTP)' },
    rows: [
      {
        protocol: 'thunder://',
        how: { zh: '迅雷 Base64 链，展开内层 HTTP 后下载。', en: 'Thunder Base64 wrapper → inner HTTP.' },
        testUrl: '',
      },
      {
        protocol: 'flashget:// / qqdl://',
        how: { zh: '快车 / QQ 旋风链，尝试 Base64 展开。', en: 'Flashget / QQDL Base64 decode.' },
        testUrl: '',
      },
    ],
  },
  {
    title: { zh: '需桌面壳或下载引擎（当前为占位）', en: 'Needs desktop / engine (placeholder)' },
    rows: [
      {
        protocol: 'magnet: / ed2k://',
        how: { zh: 'P2P，浏览器无法直接完成文件落盘。', en: 'P2P; not feasible in pure browser save.' },
        testUrl: '',
      },
      {
        protocol: 'FTP / SFTP / WebDAV / RTSP …',
        how: { zh: '非 fetch 原生能力，需后端或原生程序。', en: 'Not native to fetch; needs backend/native.' },
        testUrl: '',
      },
    ],
  },
]
