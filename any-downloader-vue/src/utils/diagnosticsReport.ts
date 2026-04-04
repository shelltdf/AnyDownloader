/** 供「分析信息」面板输出，便于 AI / 用户排查调度与服务器行为 */

export interface DiagnosticsReportInput {
  generatedAt: string
  navigator: {
    userAgent: string
    language: string
    hardwareConcurrency?: number
    /** Chrome 专有，GB */
    deviceMemory?: number
    onLine: boolean
  }
  /** 若存在 performance.memory（Chrome） */
  jsHeap?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number }
  policy: {
    taskConcurrencyMode: string
    maxConcurrentTasksManual: number
    pressureStrategy: string
    effectiveMaxConcurrentTasks: number
  }
  threads: {
    mode: string
    manualCount: number
    pressureConnectionMultiplier: number
  }
  sessionDownloadInfo: {
    connectionKind: string
    activeThreads: number | null
    bottleneck: string
  }
  tasks: {
    total: number
    running: number
    queued: number
    paused: number
    done: number
    error: number
  }
  singleConnReasonHistogram: Record<string, number>
  speedTest: {
    lastError: string | null
    regionsCount: number
  }
  buffers: {
    logLineCount: number
    globalSpeedSamples: number
    diskWriteSamples: number
  }
}

export function formatDiagnosticsReport(r: DiagnosticsReportInput): string {
  return JSON.stringify(r, null, 2)
}
