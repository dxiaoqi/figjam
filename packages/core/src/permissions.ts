import fs from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { CAPABILITIES, type Capability, type CallerInfo, type PermissionDecision, type PermissionGrant, type PermissionRequest, type PermissionSource } from '@nodboard/shared'
import type { ActivityLog } from './activity'

export interface PermissionAsk {
  capability: Capability
  target: string
  actor: CallerInfo
  source: PermissionSource
  reason: string
}

export interface PermissionResult {
  granted: boolean
  /** how it was decided: human, grant, policy, prompt, timeout, no-ui */
  via: 'human' | 'grant' | 'policy' | 'prompt' | 'timeout' | 'no-ui'
  decision?: PermissionDecision
}

/** Whose grant this is: a skill is its own subject; an agent is identified by its MCP client (Claude Code, Cursor…). */
export const subjectOf = (actor: Pick<CallerInfo, 'client' | 'name'>, source: PermissionSource) =>
  source.kind === 'skill' ? `skill:${source.id}` : `agent:${(actor.client || actor.name || 'agent').toLowerCase().replace(/\s+/g, '-')}`

interface Waiter {
  request: PermissionRequest
  resolve: (r: PermissionResult) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * One place that decides whether an agent, skill or the assistant may touch the network or a secret.
 * People acting in the canvas or with `--human` are trusted (their actions are still logged). Everyone else
 * needs a remembered grant or an answer to a prompt shown in the canvas; with no canvas open the answer is no.
 */
export class PermissionBroker {
  private waiters = new Map<string, Waiter>()
  private grantList: PermissionGrant[] = []
  /** Set by the server: how many canvases could show a prompt, and how to deliver one. */
  prompter: { available: () => boolean; show: (r: PermissionRequest) => void; settled: (id: string, decision: PermissionDecision | 'timeout') => void } = {
    available: () => false,
    show: () => {},
    settled: () => {},
  }

  constructor(
    private log: ActivityLog,
    private file: string | null,
    private timeoutMs = Number(process.env.NODBOARD_PERMISSION_TIMEOUT_MS ?? 45_000),
  ) {
    if (!file) return
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { grants?: PermissionGrant[] }
      this.grantList = (saved.grants ?? []).filter((g) => g.subject && g.capability in CAPABILITIES && g.target)
    } catch {
      // no grants yet
    }
  }

  static at(home: string, log: ActivityLog) {
    return new PermissionBroker(log, path.join(home, 'permissions.json'))
  }

  grants() {
    return [...this.grantList]
  }

  pending() {
    return [...this.waiters.values()].map((w) => w.request)
  }

  private matches(g: PermissionGrant, subject: string, capability: Capability, target: string) {
    return g.subject === subject && g.capability === capability && (g.target === '*' || g.target.toLowerCase() === target.toLowerCase())
  }

  hasGrant(subject: string, capability: Capability, target: string) {
    return this.grantList.some((g) => this.matches(g, subject, capability, target))
  }

  grant(subject: string, capability: Capability, target: string, actor: Pick<CallerInfo, 'id' | 'name' | 'client' | 'kind'> = PERSON) {
    if (!this.hasGrant(subject, capability, target)) {
      this.grantList.push({ subject, capability, target, at: Date.now() })
      this.save()
    }
    this.log.record({ category: 'permission', action: 'grant', outcome: 'ok', actor, target: `${subject} · ${capability} · ${target}` })
  }

  revoke(subject: string, capability?: Capability, target?: string, actor: Pick<CallerInfo, 'id' | 'name' | 'client' | 'kind'> = PERSON) {
    const before = this.grantList.length
    this.grantList = this.grantList.filter((g) => !(g.subject === subject && (!capability || g.capability === capability) && (!target || g.target === target)))
    if (this.grantList.length !== before) this.save()
    this.log.record({ category: 'permission', action: 'revoke', outcome: 'ok', actor, target: `${subject}${capability ? ` · ${capability}` : ''}${target ? ` · ${target}` : ''}` })
    return before - this.grantList.length
  }

  private save() {
    if (!this.file) return
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 })
    fs.writeFileSync(this.file, JSON.stringify({ grants: this.grantList }, null, 2), { mode: 0o600 })
  }

  /** Ask for a capability. Resolves when decided; never throws. */
  async request(ask: PermissionAsk): Promise<PermissionResult> {
    const { actor, capability, target, source } = ask
    const subject = subjectOf(actor, source)
    const done = (r: PermissionResult, detail?: string) => {
      this.log.record({ category: 'permission', action: 'decide', outcome: r.granted ? 'allowed' : 'denied', actor, source, target: `${capability} · ${target}`, via: r.via, detail })
      return r
    }
    if (actor.kind === 'human') return done({ granted: true, via: 'human' })
    if (this.hasGrant(subject, capability, target)) return done({ granted: true, via: 'grant' })
    if (process.env.NODBOARD_PERMISSIONS === 'deny') return done({ granted: false, via: 'policy' })
    if (!this.prompter.available()) return done({ granted: false, via: 'no-ui' }, 'no canvas open to ask')

    const request: PermissionRequest = { id: nanoid(10), capability, target, actor: { id: actor.id, name: actor.name, client: actor.client, kind: actor.kind }, source, reason: ask.reason, at: Date.now(), expiresAt: Date.now() + this.timeoutMs }
    const result = await new Promise<PermissionResult>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(request.id)
        this.prompter.settled(request.id, 'timeout')
        resolve({ granted: false, via: 'timeout' })
      }, this.timeoutMs)
      timer.unref?.()
      this.waiters.set(request.id, { request, resolve, timer })
      this.prompter.show(request)
    })
    return done(result)
  }

  /** The person's answer from the canvas (or any token holder speaking for them). */
  answer(id: string, decision: PermissionDecision): boolean {
    const w = this.waiters.get(id)
    if (!w) return false
    clearTimeout(w.timer)
    this.waiters.delete(id)
    const { request } = w
    if (decision === 'allow-always') this.grant(subjectOf(request.actor, request.source), request.capability, request.target)
    this.prompter.settled(id, decision)
    w.resolve({ granted: decision !== 'deny', via: 'prompt', decision })
    return true
  }
}

const PERSON = { id: 'human:owner', name: 'You', client: 'ui', kind: 'human' as const }

/** Error text for a denied request, telling the agent (and the person reading along) how to proceed. */
export function deniedMessage(ask: PermissionAsk, r: PermissionResult) {
  const what = `${CAPABILITIES[ask.capability].verb} ${ask.target}`
  const subject = subjectOf(ask.actor, ask.source)
  const hint = `nodboard permissions allow ${subject} ${ask.capability} ${ask.target}`
  if (r.via === 'no-ui') return `Permission needed to ${what}. Open the nodboard canvas to approve it, or allow it ahead of time with \`${hint}\`.`
  if (r.via === 'timeout') return `Permission to ${what} was not answered in time, so nothing was fetched. Ask the person to approve it in the canvas and try again.`
  if (r.via === 'policy') return `Permission to ${what} is turned off on this machine (NODBOARD_PERMISSIONS=deny).`
  return `The person declined permission to ${what}. Don't retry unless they ask you to.`
}
