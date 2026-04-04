import { ref } from 'vue'

const lines = ref<string[]>([])

/** 底部状态栏醒目提示（与日志同源写入，便于用户发现错误/警告） */
const statusHintLevel = ref<'info' | 'warn' | 'error' | null>(null)
const statusHintText = ref('')
let statusHintTimer: ReturnType<typeof setTimeout> | null = null

function ts() {
  return new Date().toISOString().slice(11, 23)
}

function clearStatusHintTimer() {
  if (statusHintTimer != null) {
    clearTimeout(statusHintTimer)
    statusHintTimer = null
  }
}

function pushLine(level: 'info' | 'warn' | 'error', msg: string) {
  lines.value = [...lines.value, `[${ts()}] [${level.toUpperCase()}] ${msg}`]
}

export function useLog() {
  function log(level: 'info' | 'warn' | 'error', msg: string) {
    pushLine(level, msg)
  }

  /**
   * 写入日志并在状态栏显示摘要；warn/error 默认较长时间或至下次提示。
   * @param persist 为 true 时不自动清除（需用户后续操作覆盖或调用 clearStatusHint）
   */
  function notify(level: 'info' | 'warn' | 'error', msg: string, opts?: { persist?: boolean }) {
    pushLine(level, msg)
    statusHintText.value = msg
    statusHintLevel.value = level
    clearStatusHintTimer()
    if (opts?.persist) return
    const ms = level === 'error' ? 28000 : level === 'warn' ? 16000 : 8000
    statusHintTimer = setTimeout(() => {
      statusHintText.value = ''
      statusHintLevel.value = null
      statusHintTimer = null
    }, ms)
  }

  function clearStatusHint() {
    clearStatusHintTimer()
    statusHintText.value = ''
    statusHintLevel.value = null
  }

  function clear() {
    lines.value = []
  }

  async function copyAll(): Promise<boolean> {
    const text = lines.value.join('\n')
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }

  return {
    lines,
    log,
    notify,
    clearStatusHint,
    statusHintLevel,
    statusHintText,
    clear,
    copyAll,
  }
}
