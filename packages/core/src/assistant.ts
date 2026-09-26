import fs from 'node:fs'
import path from 'node:path'
import { hostOf, type Block, type CallerInfo } from '@aifig/shared'
import type { ActivityLog } from './activity'
import type { CanvasCore } from './api'
import { ToolError } from './api'
import type { SecretStore } from './secrets'

/**
 * The optional built-in assistant: a thin Canvas API client that runs a few selection commands.
 * Provider settings come from the desktop app (which keeps the key with Electron safeStorage and hands it over in
 * memory) or from the canvas in a browser (the key goes to the core's SecretStore — OS keychain, else this session
 * only). Keys are never written to boards or to plain files.
 */

export type ProviderName = 'mock' | 'openai' | 'anthropic'

export interface AssistantConfig {
  provider: ProviderName | null
  key?: string
  model?: string
  baseUrl?: string
}

export type AssistantCommand = 'extract' | 'cluster' | 'tidy'

const CALLER: CallerInfo = { id: 'builtin:assistant', name: 'Assistant', client: 'builtin', kind: 'agent' }

const STOP = new Set('a an and are as at be but by for from has have i in is it its of on or our so that the their them they this to too was we were what when with you your very really just more most can cant need needs want wants'.split(' '))

// ---- providers ---------------------------------------------------------------

interface Provider {
  json(system: string, user: string): Promise<unknown>
}

function openai(cfg: AssistantConfig): Provider {
  return {
    async json(system, user) {
      const r = await fetch(`${(cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify({ model: cfg.model || 'gpt-4o-mini', response_format: { type: 'json_object' }, temperature: 0.2, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
        signal: AbortSignal.timeout(60000),
      })
      if (!r.ok) throw new ToolError(`The model provider answered ${r.status}: ${(await r.text()).slice(0, 200)}`)
      const body = (await r.json()) as { choices: { message: { content: string } }[] }
      return JSON.parse(body.choices[0].message.content)
    },
  }
}

function anthropic(cfg: AssistantConfig): Provider {
  return {
    async json(system, user) {
      const r = await fetch(`${(cfg.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': cfg.key ?? '', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: cfg.model || 'claude-3-5-haiku-latest', max_tokens: 2000, system: `${system}\nRespond with JSON only.`, messages: [{ role: 'user', content: user }] }),
        signal: AbortSignal.timeout(60000),
      })
      if (!r.ok) throw new ToolError(`The model provider answered ${r.status}: ${(await r.text()).slice(0, 200)}`)
      const body = (await r.json()) as { content: { text: string }[] }
      const text = body.content.map((c) => c.text).join('')
      return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    },
  }
}

/** Deterministic stand-in for tests and demos: sentence splitting and keyword clustering. */
function mock(): Provider {
  return {
    async json(system, user) {
      const input = JSON.parse(user) as { texts: string[] }
      if (system.startsWith('EXTRACT')) {
        const items = input.texts
          .flatMap((t) => t.split(/\n+|(?<=[.!?。！？])\s+|\s*[;；]\s*|^\s*[-*•]\s+/m))
          .map((s) => s.replace(/^[-*•\d.)\s]+/, '').replace(/[*_`]/g, '').trim())
          .filter((s) => s.length > 3)
          .map((s) => s.split(/\s+/).slice(0, 12).join(' ').replace(/[.。]$/, ''))
        return { items: [...new Set(items)].slice(0, 24) }
      }
      const words = input.texts.map((t) => t.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter((w) => w.length > 2 && !STOP.has(w)) ?? [])
      const freq = new Map<string, number>()
      for (const ws of words) for (const w of new Set(ws)) freq.set(w, (freq.get(w) ?? 0) + 1)
      const clusters: { name: string; items: number[] }[] = []
      const used = new Set<number>()
      for (const [w] of [...freq.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
        const members = words.map((ws, i) => (ws.includes(w) && !used.has(i) ? i : -1)).filter((i) => i >= 0)
        if (members.length < 2) continue
        members.forEach((i) => used.add(i))
        clusters.push({ name: w[0].toUpperCase() + w.slice(1), items: members })
        if (clusters.length >= 5) break
      }
      const rest = input.texts.map((_, i) => i).filter((i) => !used.has(i))
      if (rest.length) clusters.push({ name: 'Other', items: rest })
      return { clusters }
    },
  }
}

// ---- assistant ------------------------------------------------------------------

const PROVIDERS: ProviderName[] = ['mock', 'openai', 'anthropic']
const secretName = (p: ProviderName) => `assistant.${p}`

export class Assistant {
  private config: AssistantConfig = { provider: null }
  /** where the current key came from */
  private keySource: 'desktop' | 'store' | 'env' | null = null

  constructor(
    private core: CanvasCore,
    private secrets?: SecretStore,
    private log?: ActivityLog,
    private settingsFile?: string,
  ) {
    const env = process.env.AIFIG_ASSISTANT as ProviderName | undefined
    if (env) {
      this.configure({ provider: env, key: process.env.AIFIG_ASSISTANT_KEY, model: process.env.AIFIG_ASSISTANT_MODEL, baseUrl: process.env.AIFIG_ASSISTANT_BASE_URL })
      this.keySource = 'env'
    }
  }

  static settingsPath(home: string) {
    return path.join(home, 'assistant.json')
  }

  /** Restore browser-made settings: non-secret parts from assistant.json, the key from the SecretStore. */
  async load() {
    if (this.config.provider || !this.settingsFile) return
    let saved: Omit<AssistantConfig, 'key'>
    try {
      saved = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8'))
    } catch {
      return
    }
    if (!saved.provider || !PROVIDERS.includes(saved.provider)) return
    const key = saved.provider === 'mock' ? '' : ((await this.secrets?.get(secretName(saved.provider)).catch(() => null)) ?? '')
    this.config = { provider: saved.provider, model: saved.model, baseUrl: saved.baseUrl, key }
    this.keySource = key ? 'store' : null
  }

  /** In-memory settings pushed by the desktop shell (it owns persistence via safeStorage). */
  configure(cfg: AssistantConfig | null) {
    this.config = cfg?.provider ? { ...cfg } : { provider: null }
    this.keySource = cfg?.key ? 'desktop' : null
  }

  /** Settings made in the canvas without the desktop app. The key never touches assistant.json. */
  async save(cfg: AssistantConfig | null, actor: CallerInfo) {
    const provider = cfg?.provider && PROVIDERS.includes(cfg.provider) ? cfg.provider : null
    if (!provider) {
      if (this.settingsFile) fs.rmSync(this.settingsFile, { force: true })
      for (const p of PROVIDERS) if (p !== 'mock') await this.secrets?.delete(secretName(p)).catch(() => {})
      this.configure(null)
      return { persisted: false }
    }
    let key = provider === 'mock' ? '' : (cfg?.key ?? '')
    if (provider !== 'mock') {
      if (!this.secrets) throw new ToolError('No secret store is available')
      if (key) await this.secrets.set(secretName(provider), key)
      else key = (await this.secrets.get(secretName(provider))) ?? (this.config.provider === provider ? (this.config.key ?? '') : '')
      if (!key) throw new ToolError('Add an API key for this provider')
    }
    if (this.settingsFile) {
      fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true, mode: 0o700 })
      fs.writeFileSync(this.settingsFile, JSON.stringify({ provider, model: cfg?.model || '', baseUrl: cfg?.baseUrl || '' }), { mode: 0o600 })
    }
    this.config = { provider, key, model: cfg?.model || '', baseUrl: cfg?.baseUrl || '' }
    this.keySource = key ? 'store' : null
    this.log?.record({ category: 'secret', action: 'configure', outcome: 'ok', actor, target: `assistant · ${provider}`, via: this.secrets?.backend })
    return { persisted: provider === 'mock' || !!this.secrets?.persistent }
  }

  /** Non-secret view for the settings dialog. */
  settings() {
    const { provider, model, baseUrl, key } = this.config
    return { provider, model: model ?? '', baseUrl: baseUrl ?? '', hasKey: !!key, keySource: this.keySource, store: this.secrets ? { backend: this.secrets.backend, persistent: this.secrets.persistent, osBacked: this.secrets.osBacked } : null }
  }

  status() {
    const { provider, model, key } = this.config
    const available = provider === 'mock' || (!!provider && !!key)
    return { available, provider: available ? provider : null, model: model || null, commands: available ? (['extract', 'cluster', 'tidy'] as AssistantCommand[]) : [] }
  }

  private provider(): Provider {
    const s = this.status()
    if (!s.available) throw new ToolError('The assistant is off. Add a model provider in Assistant Settings.')
    if (this.config.provider === 'mock') return mock()
    const inner = this.config.provider === 'anthropic' ? anthropic(this.config) : openai(this.config)
    const host = hostOf(this.config.baseUrl || (this.config.provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com'))
    return {
      json: async (system, user) => {
        try {
          const out = await inner.json(system, user)
          this.log?.record({ category: 'network', action: 'model-call', outcome: 'ok', actor: CALLER, source: { kind: 'assistant', id: this.config.provider! }, target: host, via: 'user-configured', detail: `${this.keySource ?? 'no'} key` })
          return out
        } catch (e) {
          this.log?.record({ category: 'network', action: 'model-call', outcome: 'error', actor: CALLER, source: { kind: 'assistant', id: this.config.provider! }, target: host, via: 'user-configured', detail: (e as Error).message })
          throw e
        }
      },
    }
  }

  async run(boardRef: string | undefined, command: AssistantCommand, ids: string[]) {
    const board = this.core.board(boardRef)
    const blocks = ids.map((id) => board.blocks.get(id)).filter(Boolean) as Block[]
    if (!blocks.length) throw new ToolError('Select some blocks first')
    const call = async (tool: string, args: Record<string, unknown>) => {
      const r = await this.core.call({ tool: tool as never, args: { board: board.id, ...args }, caller: CALLER })
      if (!r.ok) throw new ToolError(r.error)
      return r.result as Record<string, unknown>
    }
    const textOf = (b: Block) => [b.kind === 'card' ? b.title : '', b.text].filter(Boolean).join(' — ')
    await call('set_status', { status: command === 'extract' ? 'Extracting ideas…' : command === 'cluster' ? 'Clustering…' : 'Tidying…' })

    if (command === 'tidy') {
      const frame = blocks.find((b) => b.kind === 'frame')
      if (frame) return call('tidy', { frame: frame.id, intent: `Tidy “${frame.title}”` })
      const parent = blocks[0].parent ?? null
      const siblings = blocks.filter((b) => (b.parent ?? null) === parent)
      return call('arrange', { ids: siblings.map((b) => b.id), layout: 'grid', intent: `Tidy ${siblings.length} blocks into a grid` })
    }

    const anchor = blocks.find((b) => b.kind === 'frame') ?? (blocks[0].parent ? board.blocks.get(blocks[0].parent) : undefined) ?? blocks.reduce((r, b) => (b.x + b.w > r.x + r.w ? b : r))
    const texts = blocks.filter((b) => b.kind !== 'frame' && b.kind !== 'image').map(textOf).filter(Boolean)
    if (!texts.length) throw new ToolError('The selection has no text to work with')
    const provider = this.provider()

    if (command === 'extract') {
      const out = (await provider.json('EXTRACT key ideas. Return {"items": [string]} — each item one short sticky-note sentence (max 12 words), no duplicates, in the source language.', JSON.stringify({ texts }))) as { items?: string[] }
      const items = (out.items ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, 30)
      if (!items.length) throw new ToolError('The assistant found nothing to extract')
      return call('create_blocks', { blocks: items.map((text) => ({ text, color: 'yellow' })), frame: 'Extracted ideas', right_of: anchor.id, intent: `Extract ${items.length} ideas from the selection` })
    }

    const notes = blocks.filter((b) => b.kind !== 'frame' && b.kind !== 'image')
    const out = (await provider.json('CLUSTER the notes into 2-6 themes. Return {"clusters": [{"name": string, "items": [index]}]} using 0-based indexes into texts; every index exactly once.', JSON.stringify({ texts: notes.map(textOf) }))) as { clusters?: { name: string; items: number[] }[] }
    const clusters = (out.clusters ?? []).filter((c) => c.items?.length)
    if (!clusters.length) throw new ToolError('The assistant could not find themes')
    const seen = new Set<number>()
    const payload = clusters.flatMap((c) =>
      c.items
        .filter((i) => notes[i] && !seen.has(i) && seen.add(i))
        .map((i) => ({ text: notes[i].kind === 'card' ? textOf(notes[i]) : notes[i].text, color: notes[i].color, group: c.name })),
    )
    return call('create_blocks', { blocks: payload, layout: 'cluster', frame: `Themes (${clusters.length})`, right_of: anchor.id, intent: `Cluster ${payload.length} notes into ${clusters.length} themes` })
  }
}
