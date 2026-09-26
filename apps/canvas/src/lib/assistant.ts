import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { apiFetch } from './auth'

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
      apiFetch('/api/assistant/status')
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

const LABEL = { extract: 'Extracting ideas', cluster: 'Clustering into themes', tidy: 'Tidying' } as const

export async function runAssistant(board: string, command: 'extract' | 'cluster' | 'tidy', ids: string[]) {
  const id = toast.loading(`${LABEL[command]}…`)
  try {
    const r = await apiFetch('/api/assistant/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ board, command, ids }) })
    const body = await r.json()
    if (!body.ok) throw new Error(body.error)
    toast.success(command === 'tidy' ? 'Tidied' : 'The assistant’s suggestion is ready to review', { id })
  } catch (e) {
    toast.error((e as Error).message, { id })
  }
}
