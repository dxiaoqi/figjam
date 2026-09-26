import type { SkillActivityEntry, SkillPermissionRequest, SkillCapability } from '@aifig/shared'
import type { Board } from './board'
import { newId } from './board'

/**
 * Permission + audit interface for skills.
 *
 * Integration point: the security workstream (branch cursor/security-hardening-*) adds a shared
 * PermissionBroker / ActivityLog whose requests already carry `source: { kind: 'skill', id }`. When it lands,
 * implement these two interfaces as an adapter over it (a skill tool call = its request with the tool as target)
 * and assign it to `CanvasCore.perms` — skills only use this interface. Until then `BoardPermissions` keeps
 * grants and the log inside the board document, so they travel with the board and show up in the canvas.
 */
export interface SkillPermissionBroker {
  /** Is `skill` allowed to call `tool` on this board right now? */
  check(board: Board, skill: string, tool: string): 'granted' | 'ask'
  /** Ask the person (shown as a prompt in the canvas). Returns the pending request. */
  request(board: Board, req: Omit<SkillPermissionRequest, 'id' | 'at'>): SkillPermissionRequest
  resolve(board: Board, requestId: string, decision: 'allow_once' | 'allow_board' | 'deny', by: string): SkillPermissionRequest | null
  revoke(board: Board, skill: string, tool: string | undefined, by: string): number
}

export interface SkillAuditLog {
  record(board: Board, entry: Omit<SkillActivityEntry, 'id' | 'at'>): SkillActivityEntry
  list(board: Board, filter?: { skill?: string; limit?: number }): SkillActivityEntry[]
}

const MAX_LOG = 2000

export class BoardPermissions implements SkillPermissionBroker, SkillAuditLog {
  /** One-shot approvals (allow once), consumed by the next matching call. */
  private once = new Map<string, number>()

  private key(board: Board, skill: string, tool: string) {
    return `${board.id}:${skill}:${tool}`
  }

  check(board: Board, skill: string, tool: string): 'granted' | 'ask' {
    if (board.skillGrants.has(`${skill}:${tool}`)) return 'granted'
    const k = this.key(board, skill, tool)
    const n = this.once.get(k) ?? 0
    if (n > 0) {
      this.once.set(k, n - 1)
      return 'granted'
    }
    return 'ask'
  }

  request(board: Board, req: Omit<SkillPermissionRequest, 'id' | 'at'>): SkillPermissionRequest {
    const existing = [...board.permissionRequests.values()].find((r) => r.skill === req.skill && r.tools.join() === req.tools.join() && r.action?.id === req.action?.id)
    if (existing) return existing
    const full: SkillPermissionRequest = { ...req, id: `pr${newId()}`, at: Date.now() }
    board.doc.transact(() => board.permissionRequests.set(full.id, full), 'api')
    this.record(board, { skill: req.skill, kind: 'permission', tool: req.tools.join(', '), action: req.action?.id, by: req.requestedBy, status: 'pending', detail: `Asked to use ${req.tools.join(', ')}` })
    return full
  }

  resolve(board: Board, requestId: string, decision: 'allow_once' | 'allow_board' | 'deny', by: string) {
    const req = board.permissionRequests.get(requestId)
    if (!req) return null
    board.doc.transact(() => {
      board.permissionRequests.delete(requestId)
      if (decision === 'allow_board') for (const tool of req.tools) board.skillGrants.set(`${req.skill}:${tool}`, { skill: req.skill, tool, by, at: Date.now() })
    }, 'api')
    if (decision === 'allow_once') for (const tool of req.tools) this.once.set(this.key(board, req.skill, tool), (this.once.get(this.key(board, req.skill, tool)) ?? 0) + 1)
    this.record(board, { skill: req.skill, kind: 'permission', tool: req.tools.join(', '), action: req.action?.id, by, status: decision === 'deny' ? 'denied' : 'allowed', detail: decision === 'allow_board' ? 'Allowed on this board' : decision === 'allow_once' ? 'Allowed once' : 'Denied' })
    return req
  }

  revoke(board: Board, skill: string, tool: string | undefined, by: string) {
    let n = 0
    board.doc.transact(() => {
      for (const [k, g] of [...board.skillGrants.entries()]) {
        if (g.skill === skill && (!tool || g.tool === tool)) {
          board.skillGrants.delete(k)
          n++
        }
      }
    }, 'api')
    if (n) this.record(board, { skill, kind: 'permission', tool, by, status: 'denied', detail: `Revoked ${tool ?? 'all tools'}` })
    return n
  }

  record(board: Board, entry: Omit<SkillActivityEntry, 'id' | 'at'>): SkillActivityEntry {
    const full: SkillActivityEntry = { ...entry, id: newId(), at: Date.now() }
    board.doc.transact(() => {
      board.activity.push([full])
      if (board.activity.length > MAX_LOG) board.activity.delete(0, board.activity.length - MAX_LOG)
    }, 'api')
    return full
  }

  list(board: Board, filter: { skill?: string; limit?: number } = {}) {
    const all = board.activity.toArray().filter((e) => !filter.skill || e.skill === filter.skill)
    return all.slice(-(filter.limit ?? 200)).reverse()
  }
}

export const capabilityNeedsPrompt = (c: SkillCapability) => c === 'L1'
