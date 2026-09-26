import { t } from '../i18n'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

export interface AssistantStatus {
  available: boolean
  provider: string | null
  model: string | null
  commands: ('extract' | 'cluster' | 'tidy')[]
}

const OFF: AssistantStatus = { available: false, provider: null, model: null, commands: [] }

/** Whether the optional built-in assistant is configured (it stays hidden otherwise). */
export function useAssistant() {
  const [status, setStatus] = useState<AssistantStatus>(OFF)
  useEffect(() => {
    const load = () =>
      fetch('/api/assistant/status')
        .then((r) => r.json())
        .then(setStatus)
        .catch(() => setStatus(OFF))
    load()
    window.addEventListener('aifig:assistant-changed', load)
    const t = setInterval(load, 15000)
    return () => {
      window.removeEventListener('aifig:assistant-changed', load)
      clearInterval(t)
    }
  }, [])
  return status
}

const LABEL = { extract: 'assistant.extracting', cluster: 'assistant.clustering', tidy: 'assistant.tidying' } as const

export async function runAssistant(board: string, command: 'extract' | 'cluster' | 'tidy', ids: string[]) {
  const id = toast.loading(`${t(LABEL[command])}…`)
  try {
    const r = await fetch('/api/assistant/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ board, command, ids }) })
    const body = await r.json()
    if (!body.ok) throw new Error(body.error)
    toast.success(t(command === 'tidy' ? 'assistant.tidied' : 'assistant.ready'), { id })
  } catch (e) {
    toast.error((e as Error).message, { id })
  }
}
