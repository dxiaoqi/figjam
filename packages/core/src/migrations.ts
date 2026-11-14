import type * as Y from 'yjs'
import { assetIdFor, extForMime, SNIPPET_FILES, SNIPPET_ROLES, snippetThumbKey, type Asset, type Block, type ChangeSet, type WebSnippet } from '@nodboard/shared'
import { compareSchema, CURRENT_SCHEMA, formatSchema, FutureVersionError, type SchemaVersion } from './fileformat'

/**
 * Forward-only migrations of the board document. Each step moves the doc from one schema version to the
 * next inside one Yjs transaction. Minor versions are additive (older builds may open them and keep the
 * unknown data); a new major version is a breaking change that older builds refuse to open.
 */
export interface Migration {
  from: SchemaVersion
  to: SchemaVersion
  description: string
  up(doc: Y.Doc, ctx: MigrationContext): void
}

/** What a migration may do outside the document. */
export interface MigrationContext {
  /** Write bytes to the board's assets folder; returns their SHA-256. */
  putFile(bytes: Uint8Array, ext: string): string
}

const noFiles: MigrationContext = {
  putFile() {
    throw new Error('This migration needs an assets folder to write to')
  },
}

/** Schema 1.x → 2.0: file bytes and inline snippet source move out of the document into asset files. */
function assetsToFiles(doc: Y.Doc, ctx: MigrationContext) {
  const assets = doc.getMap<Asset | { bytes?: Uint8Array; mime: string; w?: number; h?: number; name?: string; createdAt?: number }>('assets')
  const blocks = doc.getMap<Block>('blocks')
  const changeSets = doc.getMap<ChangeSet>('changeSets')
  const roles = new Map<string, Asset['role']>()
  for (const b of blocks.values()) {
    if (b.asset) roles.set(b.asset, b.kind === 'video' ? 'video' : 'image')
    if (b.web?.thumb) roles.set(b.web.thumb, 'preview')
  }
  for (const [id, a] of [...assets.entries()]) {
    const bytes = (a as { bytes?: unknown }).bytes
    if (!(bytes instanceof Uint8Array)) continue
    const ext = extForMime(a.mime)
    const hash = ctx.putFile(bytes, ext)
    const legacy = a as { w?: number; h?: number; name?: string; createdAt?: number }
    const role = roles.get(id) ?? (legacy.name === 'poster' ? 'preview' : 'image')
    assets.set(id, { id, hash, ext, mime: a.mime, size: bytes.byteLength, role, ...(legacy.w ? { w: legacy.w, h: legacy.h } : {}), ...(legacy.name ? { name: legacy.name } : {}), createdAt: legacy.createdAt ?? Date.now() })
  }
  const convertWeb = (web: WebSnippet): WebSnippet => {
    if (web.mode !== 'inline' || web.src) return web
    const src: NonNullable<WebSnippet['src']> = {}
    for (const k of ['html', 'css', 'js'] as const) {
      const text = web[k]
      if (!text) continue
      const bytes = new TextEncoder().encode(text)
      const hash = ctx.putFile(bytes, k)
      const id = assetIdFor(hash)
      if (!assets.has(id)) assets.set(id, { id, hash, ext: k, mime: SNIPPET_FILES[k].mime, size: bytes.byteLength, role: SNIPPET_ROLES[k], name: SNIPPET_FILES[k].name, createdAt: Date.now() })
      src[k] = id
    }
    const { html: _h, css: _c, js: _j, ...rest } = web
    const next: WebSnippet = { ...rest, src }
    if (web.thumbFor && web.thumbFor === snippetThumbKey(web)) next.thumbFor = snippetThumbKey(next)
    return next
  }
  const convertBlock = <T>(b: T): T => {
    const blk = b as Block
    return blk?.kind === 'web' && blk.web ? ({ ...blk, web: convertWeb(blk.web) } as T) : b
  }
  for (const [id, b] of [...blocks.entries()]) if (b.kind === 'web' && b.web?.mode === 'inline' && !b.web.src) blocks.set(id, convertBlock(b))
  for (const [id, cs] of [...changeSets.entries()]) {
    const fix = (entries?: ChangeSet['entries']) => entries?.map((e) => (e.op === 'create' || e.target !== 'block' ? e : { ...e, before: convertBlock(e.before) }))
    const next = { ...cs, entries: fix(cs.entries)!, ...(cs.accepted ? { accepted: fix(cs.accepted) } : {}) }
    if (JSON.stringify(next) !== JSON.stringify(cs)) changeSets.set(id, next)
  }
}

export const MIGRATIONS: Migration[] = [
  {
    from: { major: 0, minor: 0 },
    to: { major: 1, minor: 0 },
    description: 'Container format with checksums; schema version recorded in the document',
    up(doc) {
      const meta = doc.getMap<unknown>('meta')
      const blocks = doc.getMap<{ createdAt?: number }>('blocks')
      if (!meta.get('createdAt')) {
        const oldest = Math.min(...[...blocks.values()].map((b) => b.createdAt ?? Infinity))
        meta.set('createdAt', Number.isFinite(oldest) ? oldest : Date.now())
      }
      if (!meta.get('updatedAt')) meta.set('updatedAt', meta.get('createdAt'))
      if (!meta.get('title')) meta.set('title', 'Untitled board')
      meta.delete('format')
    },
  },
  {
    from: { major: 1, minor: 0 },
    to: { major: 2, minor: 0 },
    description: 'Images and web snippet source stored as files in the assets folder next to the board',
    up: assetsToFiles,
  },
]

export interface MigrationResult {
  from: SchemaVersion
  to: SchemaVersion
  applied: string[]
  /** The file is a newer minor version of the current major; it opens as is. */
  newerMinor: boolean
}

/** Bring `doc` from schema `from` up to `target`. Throws FutureVersionError for a newer major. */
export function migrate(doc: Y.Doc, from: SchemaVersion, migrations: Migration[] = MIGRATIONS, target: SchemaVersion = CURRENT_SCHEMA, ctx: MigrationContext = noFiles): MigrationResult {
  if (from.major > target.major) throw new FutureVersionError(formatSchema(from), undefined)
  const meta = doc.getMap<unknown>('meta')
  if (compareSchema(from, target) >= 0) {
    return { from, to: from, applied: [], newerMinor: compareSchema(from, target) > 0 }
  }
  const applied: string[] = []
  let cur = from
  doc.transact(() => {
    while (compareSchema(cur, target) < 0) {
      // a 1.x minor we don't know steps from its major's last known minor
      const step = migrations.find((m) => compareSchema(m.from, cur) === 0) ?? migrations.find((m) => m.from.major === cur.major && compareSchema(m.to, cur) > 0 && m.to.major > cur.major)
      if (!step) throw new Error(`No migration from file format ${formatSchema(cur)} towards ${formatSchema(target)}`)
      if (compareSchema(step.to, cur) <= 0) throw new Error(`Migration ${formatSchema(step.from)} → ${formatSchema(step.to)} does not move forward`)
      step.up(doc, ctx)
      applied.push(`${formatSchema(step.from)} → ${formatSchema(step.to)}: ${step.description}`)
      cur = step.to
    }
    meta.set('schema', formatSchema(cur))
  }, 'migration')
  return { from, to: cur, applied, newerMinor: false }
}
