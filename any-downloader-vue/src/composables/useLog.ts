import { ref } from 'vue'

const lines = ref<string[]>([])

function ts() {
  return new Date().toISOString().slice(11, 23)
}

export function useLog() {
  function log(level: 'info' | 'warn' | 'error', msg: string) {
    lines.value = [...lines.value, `[${ts()}] [${level.toUpperCase()}] ${msg}`]
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

  return { lines, log, clear, copyAll }
}
