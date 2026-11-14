/**
 * Shared security vocabulary: local access token transport, permission requests and the activity log.
 * The core owns the logic (`@nodboard/core` PermissionBroker / ActivityLog / SecretStore); the canvas renders
 * prompts and the log; Skills reuse the same request shape with `source.kind = 'skill'`.
 */
import type { CallerInfo } from './tools'

/** File under NODBOARD_HOME holding the per-install access token (created by the core, mode 0600). */
export const TOKEN_FILE = 'access-token'
/** WebSocket subprotocol the core selects; the token travels as a second offered protocol `nodboard-token.<token>`. */
export const WS_PROTOCOL = 'nodboard'
export const WS_TOKEN_PREFIX = 'nodboard-token.'

/** What an action needs the person's OK for. Extend here (and in the prompt copy) rather than inventing ad-hoc checks. */
export type Capability = 'network' | 'secrets' | 'tool'

export const CAPABILITIES: Record<Capability, { label: string; verb: string }> = {
  network: { label: 'Network access', verb: 'connect to' },
  secrets: { label: 'Secret access', verb: 'use the secret' },
  /** a skill (L1) calling a tool by name; target = the tool, e.g. web.search */
  tool: { label: 'Tool use', verb: 'use the tool' },
}

export type PermissionDecision = 'allow-once' | 'allow-always' | 'deny'

/** Who is asking on whose behalf: a tool call, a skill, the built-in assistant… */
export interface PermissionSource {
  kind: 'tool' | 'skill' | 'assistant' | 'snippet'
  /** tool name, skill id, … */
  id: string
  board?: string
}

export interface PermissionRequest {
  id: string
  capability: Capability
  /** host for network, secret name for secrets */
  target: string
  actor: Pick<CallerInfo, 'id' | 'name' | 'client' | 'kind'>
  source: PermissionSource
  /** one sentence, shown in the prompt */
  reason: string
  at: number
  expiresAt: number
}

export interface PermissionGrant {
  /** agent client (e.g. "claude-code") or skill id the grant belongs to */
  subject: string
  capability: Capability
  /** host / secret name, or "*" */
  target: string
  at: number
}

export type ActivityCategory = 'network' | 'secret' | 'permission' | 'auth' | 'skill'
export type ActivityOutcome = 'allowed' | 'denied' | 'ok' | 'error'

export interface ActivityEntry {
  id: string
  at: number
  category: ActivityCategory
  /** short machine-friendly verb: fetch, prompt, grant, revoke, store, read, delete, reject-token… */
  action: string
  outcome: ActivityOutcome
  actor: Pick<CallerInfo, 'id' | 'name' | 'client' | 'kind'>
  source?: PermissionSource
  /** host, secret name or route — never a secret value or a full URL with query */
  target?: string
  /** how the outcome was reached: grant, prompt, policy, timeout, no-ui… */
  via?: string
  detail?: string
}

export type SecurityServerMessage =
  | { type: 'permission'; request: PermissionRequest }
  | { type: 'permission-settled'; id: string; decision: PermissionDecision | 'timeout' }
  | { type: 'activity'; entry: ActivityEntry }

/** Host part of a URL for prompts and logs (drops credentials, path and query). */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return String(url).slice(0, 80)
  }
}
