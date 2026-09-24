import type { Block } from './model'
import type { ColorToken } from './tokens'

/**
 * Built-in block types (Phase 1, gradual structuring). A type is a lens on a sticky or card: a color, an icon
 * and at most three small fields. Anything deeper (custom schemas, behaviour) belongs to Skills.
 */
export const BLOCK_TYPE_IDS = ['insight', 'question', 'quote', 'hypothesis', 'idea', 'todo'] as const
export type BlockTypeId = (typeof BLOCK_TYPE_IDS)[number]

export type FieldValue = string | number | boolean
export type FieldDef =
  | { key: string; label: string; kind: 'text'; placeholder?: string }
  | { key: string; label: string; kind: 'enum'; options: readonly string[]; default?: string }
  | { key: string; label: string; kind: 'boolean'; default?: boolean }

export interface BlockTypeDef {
  id: BlockTypeId
  label: string
  plural: string
  /** Type-driven color token (blocks take it when promoted). */
  color: ColorToken
  /** lucide icon name, rendered by the canvas; exports use `glyph`. */
  icon: string
  glyph: string
  description: string
  fields: readonly FieldDef[]
  /** Leading text that types a sticky automatically (can be turned off). */
  prefixes: readonly string[]
}

export const MAX_TYPE_FIELDS = 3
export const MAX_FIELD_TEXT = 120

export const BLOCK_TYPES: Record<BlockTypeId, BlockTypeDef> = {
  insight: {
    id: 'insight',
    label: 'Insight',
    plural: 'Insights',
    color: 'purple',
    icon: 'Sparkles',
    glyph: '✦',
    description: 'A finding worth acting on, backed by evidence.',
    fields: [],
    prefixes: ['!', 'insight:'],
  },
  question: {
    id: 'question',
    label: 'Question',
    plural: 'Questions',
    color: 'blue',
    icon: 'CircleHelp',
    glyph: '?',
    description: 'Something the team does not know yet.',
    fields: [],
    prefixes: ['?', 'q:'],
  },
  quote: {
    id: 'quote',
    label: 'Quote',
    plural: 'Quotes',
    color: 'teal',
    icon: 'Quote',
    glyph: '❝',
    description: 'Verbatim words from a person or document.',
    fields: [
      { key: 'interviewee', label: 'Who', kind: 'text', placeholder: 'P3' },
      { key: 'source', label: 'Source', kind: 'text', placeholder: 'Interview, 12 May' },
    ],
    prefixes: ['"', '“', '>'],
  },
  hypothesis: {
    id: 'hypothesis',
    label: 'Hypothesis',
    plural: 'Hypotheses',
    color: 'orange',
    icon: 'FlaskConical',
    glyph: '⚗',
    description: 'A belief to test.',
    fields: [
      { key: 'status', label: 'Status', kind: 'enum', options: ['unverified', 'supported', 'refuted'], default: 'unverified' },
      { key: 'confidence', label: 'Confidence', kind: 'enum', options: ['low', 'medium', 'high'], default: 'medium' },
    ],
    prefixes: ['h:', 'hyp:', 'we believe'],
  },
  idea: {
    id: 'idea',
    label: 'Idea',
    plural: 'Ideas',
    color: 'yellow',
    icon: 'Lightbulb',
    glyph: '✱',
    description: 'A possible solution or direction.',
    fields: [],
    prefixes: ['idea:', '💡'],
  },
  todo: {
    id: 'todo',
    label: 'Todo',
    plural: 'Todos',
    color: 'green',
    icon: 'SquareCheck',
    glyph: '☐',
    description: 'A next step with an owner.',
    fields: [
      { key: 'owner', label: 'Owner', kind: 'text', placeholder: 'Who' },
      { key: 'done', label: 'Done', kind: 'boolean', default: false },
    ],
    prefixes: ['[]', '[ ]', 'todo:'],
  },
}

export const TYPEABLE_KINDS = ['sticky', 'card'] as const

export function isBlockType(v: unknown): v is BlockTypeId {
  return typeof v === 'string' && (BLOCK_TYPE_IDS as readonly string[]).includes(v)
}

/** Fields of a block for its current type, with defaults filled in. */
export function typeFields(b: Pick<Block, 'type' | 'typeData'>): Record<string, FieldValue> {
  if (!b.type) return {}
  const def = BLOCK_TYPES[b.type]
  const stored = b.typeData?.[b.type] ?? {}
  const out: Record<string, FieldValue> = {}
  for (const f of def.fields) {
    const v = stored[f.key]
    if (v !== undefined && v !== '') out[f.key] = v
    else if (f.kind !== 'text' && f.default !== undefined) out[f.key] = f.default
  }
  return out
}

/** Validate and coerce field values for a type (strings from the CLI, loose agent input). */
export function coerceFields(type: BlockTypeId, input: Record<string, unknown>): { fields: Record<string, FieldValue>; errors: string[] } {
  const def = BLOCK_TYPES[type]
  const fields: Record<string, FieldValue> = {}
  const errors: string[] = []
  for (const [k, raw] of Object.entries(input)) {
    const f = def.fields.find((x) => x.key === k)
    if (!f) {
      errors.push(
        def.fields.length
          ? `${def.label} has no field "${k}" (fields: ${def.fields.map((x) => x.key).join(', ')}). Types stay small on purpose — richer schemas belong to Skills.`
          : `${def.label} has no fields. Types stay small on purpose — richer schemas belong to Skills.`,
      )
      continue
    }
    if (f.kind === 'boolean') {
      const v = typeof raw === 'boolean' ? raw : /^(true|yes|1|done|x)$/i.test(String(raw)) ? true : /^(false|no|0|)$/i.test(String(raw)) ? false : null
      if (v === null) errors.push(`${f.label} must be true or false`)
      else fields[k] = v
    } else if (f.kind === 'enum') {
      const v = String(raw).toLowerCase()
      if (!f.options.includes(v)) errors.push(`${f.label} must be one of ${f.options.join(', ')}`)
      else fields[k] = v
    } else fields[k] = String(raw).slice(0, MAX_FIELD_TEXT)
  }
  return { fields, errors }
}

/** Leading-prefix auto typing: "? why do people churn" → question "why do people churn". */
export function detectPrefix(text: string): { type: BlockTypeId; text: string } | null {
  const t = text.trimStart()
  const lower = t.toLowerCase()
  for (const def of Object.values(BLOCK_TYPES)) {
    for (const p of def.prefixes) {
      if (!lower.startsWith(p)) continue
      const rest = t.slice(p.length)
      if (/^[a-z]/i.test(p.at(-1)!) && rest && !/^[\s:]/.test(rest)) continue
      if (def.id === 'quote') return { type: 'quote', text: rest.replace(/^\s+/, '').replace(/["”]\s*$/, '') }
      const clean = rest.replace(/^\s*:?\s*/, '')
      if (!clean) return null
      return { type: def.id, text: clean }
    }
  }
  return null
}

/** Suggested meaning of a connector between two typed blocks (stored on the connector, optional). */
export const RELATIONS = ['supports', 'contradicts', 'raises', 'answers', 'tests', 'inspires', 'addresses'] as const
export type Relation = (typeof RELATIONS)[number]

const RELATION_TABLE: Partial<Record<BlockTypeId, Partial<Record<BlockTypeId, Relation>>>> = {
  quote: { insight: 'supports', hypothesis: 'supports', question: 'raises' },
  insight: { question: 'raises', idea: 'inspires', hypothesis: 'supports' },
  question: { hypothesis: 'raises', idea: 'inspires' },
  hypothesis: { todo: 'tests', question: 'answers' },
  idea: { question: 'answers', todo: 'addresses', insight: 'addresses' },
  todo: { hypothesis: 'tests', question: 'answers' },
}

export function suggestRelation(from?: BlockTypeId, to?: BlockTypeId): Relation | undefined {
  return from && to ? RELATION_TABLE[from]?.[to] : undefined
}

/** Does a block match a type / field query? Values compare case-insensitively; booleans accept true/false strings. */
export function matchesQuery(b: Pick<Block, 'type' | 'typeData'>, q: { type?: BlockTypeId | null; where?: Record<string, unknown> }) {
  if (q.type && b.type !== q.type) return false
  if (q.type === null && b.type) return false
  const where = q.where ?? {}
  if (!Object.keys(where).length) return true
  const f = typeFields(b)
  return Object.entries(where).every(([k, v]) => {
    const have = f[k]
    if (have === undefined) return false
    if (typeof have === 'boolean') return have === (typeof v === 'boolean' ? v : /^(true|yes|1|done)$/i.test(String(v)))
    return String(have).toLowerCase() === String(v).toLowerCase()
  })
}

/** One-line field summary: "unverified · high", "P3 · Interview", "@maya · done". */
export function fieldSummary(b: Pick<Block, 'type' | 'typeData'>): string {
  if (!b.type) return ''
  const def = BLOCK_TYPES[b.type]
  const f = typeFields(b)
  return def.fields
    .map((d) => {
      const v = f[d.key]
      if (v === undefined || v === '') return ''
      if (d.kind === 'boolean') return v ? d.label.toLowerCase() : ''
      return String(v)
    })
    .filter(Boolean)
    .join(' · ')
}

for (const def of Object.values(BLOCK_TYPES)) {
  if (def.fields.length > MAX_TYPE_FIELDS) throw new Error(`Type ${def.id} has more than ${MAX_TYPE_FIELDS} fields`)
}

/**
 * Patch that promotes a block to `type` (merging `fields`), updates fields (`type` undefined), or demotes it
 * (`type` null). Never drops data: demoting keeps every type's fields and restores the block's own color.
 */
export function typePatch(
  b: Pick<Block, 'kind' | 'type' | 'typeData' | 'color'>,
  type: BlockTypeId | null | undefined,
  fields: Record<string, FieldValue> = {},
): Partial<Block> {
  const data: NonNullable<Block['typeData']> = { ...(b.typeData ?? {}) }
  if (type === null) return b.type ? { type: undefined, color: data._color ?? b.color, typeData: data } : {}
  const t = type ?? b.type
  if (!t) return {}
  if (!b.type && data._color === undefined) data._color = b.color
  data[t] = { ...(data[t] ?? {}), ...fields }
  return { type: t, typeData: data, color: BLOCK_TYPES[t].color }
}

/** Extra height the type header (and the collapsed field summary) adds inside a block. */
export function typeChrome(b: Pick<Block, 'type' | 'typeData'>) {
  if (!b.type) return 0
  return 22 + (BLOCK_TYPES[b.type].fields.length ? 26 : 0)
}
