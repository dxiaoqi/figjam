import type { Block } from './model'
import type { ColorToken } from './tokens'

/**
 * Block types. Built-in types (Phase 1, gradual structuring) are a lens on a sticky or card: a color, an icon
 * and at most three small fields. Skills add their own namespaced types (e.g. `research.quote`) with a few more
 * fields and a card template; they share every mechanism here through a `TypeRegistry`.
 */
export const BLOCK_TYPE_IDS = ['insight', 'question', 'quote', 'hypothesis', 'idea', 'todo'] as const
export type BlockTypeId = (typeof BLOCK_TYPE_IDS)[number]
/** Any type id: a built-in one or a skill type (`<skill>.<type>`). */
export type TypeId = string

export type FieldValue = string | number | boolean
export type FieldDef =
  | { key: string; label: string; kind: 'text'; placeholder?: string }
  | { key: string; label: string; kind: 'number'; default?: number; unit?: string }
  | { key: string; label: string; kind: 'enum'; options: readonly string[]; default?: string }
  | { key: string; label: string; kind: 'boolean'; default?: boolean }

export interface BlockTypeDef {
  id: TypeId
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
  /** Skill that defines this type (absent for built-ins). */
  skill?: string
  /** Which block a new block of this type is (skill types; built-ins apply to stickies and cards). */
  base?: 'sticky' | 'card'
  /** Card template: fields shown as label/value rows on the block, and in the one-line summary. */
  template?: { rows?: readonly string[]; summary?: readonly string[] }
  /** Suggested relation from this type to others, by target type id. */
  relations?: Readonly<Record<string, Relation>>
}

export type TypeRegistry = Readonly<Record<TypeId, BlockTypeDef>>

export const MAX_TYPE_FIELDS = 3
/** Skill types may carry a few more fields than built-ins; anything deeper is a document, not a block. */
export const MAX_SKILL_TYPE_FIELDS = 8
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

export const BUILTIN_TYPES: TypeRegistry = BLOCK_TYPES

export const TYPEABLE_KINDS = ['sticky', 'card'] as const

export function isBlockType(v: unknown, reg: TypeRegistry = BUILTIN_TYPES): v is TypeId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(reg, v)
}

/** Definition for a type id; unknown ids (e.g. a skill that was disabled) get a neutral stand-in, data intact. */
export function typeDef(id: TypeId, reg: TypeRegistry = BUILTIN_TYPES): BlockTypeDef {
  const d = reg[id]
  if (d) return d
  const [skill, name] = id.includes('.') ? id.split('.', 2) : [undefined, id]
  const label = (name ?? id).replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase())
  return { id, label, plural: label, color: 'gray', icon: 'Tag', glyph: '•', description: skill ? `From the “${skill}” skill (not enabled on this board)` : '', fields: [], prefixes: [], skill }
}

/** Fields of a block for its current type, with defaults filled in. */
export function typeFields(b: Pick<Block, 'type' | 'typeData'>, reg: TypeRegistry = BUILTIN_TYPES): Record<string, FieldValue> {
  if (!b.type) return {}
  const def = typeDef(b.type, reg)
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
export function coerceFields(type: TypeId, input: Record<string, unknown>, reg: TypeRegistry = BUILTIN_TYPES): { fields: Record<string, FieldValue>; errors: string[] } {
  const def = typeDef(type, reg)
  const fields: Record<string, FieldValue> = {}
  const errors: string[] = []
  const pointer = def.skill ? '' : ' Types stay small on purpose — richer schemas belong to Skills.'
  for (const [k, raw] of Object.entries(input)) {
    const f = def.fields.find((x) => x.key === k)
    if (!f) {
      errors.push(def.fields.length ? `${def.label} has no field "${k}" (fields: ${def.fields.map((x) => x.key).join(', ')}).${pointer}` : `${def.label} has no fields.${pointer}`)
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
    } else if (f.kind === 'number') {
      const v = typeof raw === 'number' ? raw : Number(String(raw).replace(/[,\s]/g, '').replace(/^[$€£¥]/, ''))
      if (!Number.isFinite(v)) errors.push(`${f.label} must be a number`)
      else fields[k] = v
    } else fields[k] = String(raw).slice(0, MAX_FIELD_TEXT)
  }
  return { fields, errors }
}

/** Leading-prefix auto typing: "? why do people churn" → question "why do people churn". */
export function detectPrefix(text: string, reg: TypeRegistry = BUILTIN_TYPES): { type: TypeId; text: string } | null {
  const t = text.trimStart()
  const lower = t.toLowerCase()
  for (const def of Object.values(reg)) {
    for (const p of def.prefixes) {
      if (!lower.startsWith(p.toLowerCase())) continue
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
/** Built-in relations, or a verb a skill declares (e.g. "competes with"). */
export type Relation = (typeof RELATIONS)[number] | (string & {})

const RELATION_TABLE: Partial<Record<BlockTypeId, Partial<Record<BlockTypeId, Relation>>>> = {
  quote: { insight: 'supports', hypothesis: 'supports', question: 'raises' },
  insight: { question: 'raises', idea: 'inspires', hypothesis: 'supports' },
  question: { hypothesis: 'raises', idea: 'inspires' },
  hypothesis: { todo: 'tests', question: 'answers' },
  idea: { question: 'answers', todo: 'addresses', insight: 'addresses' },
  todo: { hypothesis: 'tests', question: 'answers' },
}

export function suggestRelation(from?: TypeId, to?: TypeId, reg: TypeRegistry = BUILTIN_TYPES): Relation | undefined {
  if (!from || !to) return undefined
  return reg[from]?.relations?.[to] ?? RELATION_TABLE[from as BlockTypeId]?.[to as BlockTypeId]
}

/** Does a block match a type / field query? Values compare case-insensitively; booleans accept true/false strings. */
export function matchesQuery(b: Pick<Block, 'type' | 'typeData'>, q: { type?: TypeId | null; where?: Record<string, unknown> }, reg: TypeRegistry = BUILTIN_TYPES) {
  if (q.type && b.type !== q.type) return false
  if (q.type === null && b.type) return false
  const where = q.where ?? {}
  if (!Object.keys(where).length) return true
  const f = typeFields(b, reg)
  return Object.entries(where).every(([k, v]) => {
    const have = f[k]
    if (have === undefined) return false
    if (typeof have === 'boolean') return have === (typeof v === 'boolean' ? v : /^(true|yes|1|done)$/i.test(String(v)))
    if (typeof have === 'number') return have === Number(v)
    return String(have).toLowerCase() === String(v).toLowerCase()
  })
}

const fieldText = (d: FieldDef, v: FieldValue | undefined) => {
  if (v === undefined || v === '') return ''
  if (d.kind === 'boolean') return v ? d.label.toLowerCase() : ''
  if (d.kind === 'number') return `${typeof v === 'number' ? v.toLocaleString('en-US') : v}${d.unit ? ` ${d.unit}` : ''}`
  return String(v)
}

/** One-line field summary: "unverified · high", "P3 · Interview", "@maya · done". */
export function fieldSummary(b: Pick<Block, 'type' | 'typeData'>, reg: TypeRegistry = BUILTIN_TYPES): string {
  if (!b.type) return ''
  const def = typeDef(b.type, reg)
  const f = typeFields(b, reg)
  const keys = def.template?.summary ?? def.fields.filter((d) => !def.template?.rows?.includes(d.key)).map((d) => d.key)
  return keys
    .map((k) => def.fields.find((d) => d.key === k))
    .filter((d): d is FieldDef => !!d)
    .map((d) => fieldText(d, f[d.key]))
    .filter(Boolean)
    .join(' · ')
}

/** Label/value rows a card template shows on the block. */
export function templateRows(b: Pick<Block, 'type' | 'typeData'>, reg: TypeRegistry = BUILTIN_TYPES): { key: string; label: string; value: string }[] {
  if (!b.type) return []
  const def = typeDef(b.type, reg)
  const f = typeFields(b, reg)
  return (def.template?.rows ?? [])
    .map((k) => def.fields.find((d) => d.key === k))
    .filter((d): d is FieldDef => !!d)
    .map((d) => ({ key: d.key, label: d.label, value: d.kind === 'boolean' ? (f[d.key] === undefined ? '' : f[d.key] ? 'Yes' : 'No') : fieldText(d, f[d.key]) }))
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
  type: TypeId | null | undefined,
  fields: Record<string, FieldValue> = {},
  reg: TypeRegistry = BUILTIN_TYPES,
): Partial<Block> {
  const data: NonNullable<Block['typeData']> = { ...(b.typeData ?? {}) }
  const own = data as unknown as { _color?: ColorToken }
  if (type === null) return b.type ? { type: undefined, color: own._color ?? b.color, typeData: data } : {}
  const t = type ?? b.type
  if (!t) return {}
  if (!b.type && own._color === undefined) own._color = b.color
  data[t] = { ...(data[t] ?? {}), ...fields }
  return { type: t, typeData: data, color: typeDef(t, reg).color }
}

/** Extra height the type header, template rows and the collapsed field summary add inside a block. */
export function typeChrome(b: Pick<Block, 'type' | 'typeData'>, reg: TypeRegistry = BUILTIN_TYPES) {
  if (!b.type) return 0
  const def = typeDef(b.type, reg)
  const rows = def.template?.rows?.length ?? 0
  const summary = fieldSummary(b, reg) || (def.fields.length > rows && !def.template?.rows) ? 26 : 0
  return 22 + (rows ? rows * 20 + 6 : 0) + summary
}
