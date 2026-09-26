import { toast } from 'sonner'
import { callCore } from './core'
import { S } from './strings'

/** Run a skill action. The first use of a tool shows the permission prompt; the call waits for the answer. */
export async function runSkillAction(board: string, skill: string, action: string, ids: string[]) {
  try {
    const r = await callCore<{ status: string; results?: { status: string; created?: number; error?: string }[] }>('run_skill_action', { board, skill, action, ids })
    reportActionResult(r)
  } catch (e) {
    toast.error((e as Error).message)
  }
}

export function reportActionResult(r: { status: string; results?: { status: string; created?: number; error?: string }[] }) {
  const failed = r.results?.filter((x) => x.status === 'error') ?? []
  const created = r.results?.reduce((n, x) => n + (x.created ?? 0), 0) ?? 0
  if (failed.length) toast.error(S.skills.actionFailed(failed.length), { description: failed[0].error })
  else toast.success(S.skills.actionDone(created))
}
