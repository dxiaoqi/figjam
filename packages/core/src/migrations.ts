import type * as Y from 'yjs'
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
  up(doc: Y.Doc): void
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
]

export interface MigrationResult {
  from: SchemaVersion
  to: SchemaVersion
  applied: string[]
  /** The file is a newer minor version of the current major; it opens as is. */
  newerMinor: boolean
}

/** Bring `doc` from schema `from` up to `target`. Throws FutureVersionError for a newer major. */
export function migrate(doc: Y.Doc, from: SchemaVersion, migrations: Migration[] = MIGRATIONS, target: SchemaVersion = CURRENT_SCHEMA): MigrationResult {
  if (from.major > target.major) throw new FutureVersionError(formatSchema(from), undefined)
  const meta = doc.getMap<unknown>('meta')
  if (compareSchema(from, target) >= 0) {
    return { from, to: from, applied: [], newerMinor: compareSchema(from, target) > 0 }
  }
  const applied: string[] = []
  let cur = from
  doc.transact(() => {
    while (compareSchema(cur, target) < 0) {
      const step = migrations.find((m) => compareSchema(m.from, cur) === 0)
      if (!step) throw new Error(`No migration from file format ${formatSchema(cur)} towards ${formatSchema(target)}`)
      if (compareSchema(step.to, cur) <= 0) throw new Error(`Migration ${formatSchema(step.from)} → ${formatSchema(step.to)} does not move forward`)
      step.up(doc)
      applied.push(`${formatSchema(step.from)} → ${formatSchema(step.to)}: ${step.description}`)
      cur = step.to
    }
    meta.set('schema', formatSchema(cur))
  }, 'migration')
  return { from, to: cur, applied, newerMinor: false }
}
