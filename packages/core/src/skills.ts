import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import {
  BUILTIN_SKILL_TOOLS,
  BUILTIN_TYPES,
  COLOR_TOKENS,
  MAX_SKILL_TYPE_FIELDS,
  SKILL_ICONS,
  SKILL_NAME,
  isFieldKind,
  type BlockTypeDef,
  type ColorToken,
  type FieldDef,
  type Relation,
  type SkillAction,
  type SkillCanvas,
  type SkillLayout,
  type SkillManifest,
  type SkillPrompt,
} from '@aifig/shared'
import { aifigHome } from './board'

const LAYOUT_INTENTS = ['grid', 'matrix', 'timeline', 'flow', 'cluster', 'type'] as const

type Json = Record<string, unknown>

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

/** Split SKILL.md into YAML frontmatter and the Markdown body. */
function frontmatter(src: string): { data: Json; body: string; error?: string } {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { data: {}, body: src, error: 'SKILL.md must start with a `---` YAML frontmatter block (name, description)' }
  try {
    const data = yaml.load(m[1])
    return { data: isObj(data) ? data : {}, body: m[2].trim() }
  } catch (e) {
    return { data: {}, body: m[2], error: `SKILL.md frontmatter is not valid YAML: ${(e as Error).message.split('\n')[0]}` }
  }
}

/**
 * Read and validate a skill folder. Always returns a manifest (so errors can be shown next to the skill);
 * `errors` non-empty means it can't be enabled.
 */
export function loadSkill(dir: string, source: SkillManifest['source']): SkillManifest {
  const errors: string[] = []
  const warnings: string[] = []
  const at = (file: string, where: string, msg: string) => `${file}${where ? ` › ${where}` : ''}: ${msg}`
  const skillMd = path.join(dir, 'SKILL.md')
  const empty: SkillCanvas = { types: [], layouts: [], actions: [], prompts: [] }
  if (!fs.existsSync(skillMd)) {
    return { name: path.basename(dir), description: '', version: '0.0.0', capability: 'L0', permissions: { tools: [] }, instructions: '', canvas: empty, source, path: dir, errors: [`No SKILL.md in ${dir}`], warnings }
  }
  const fm = frontmatter(fs.readFileSync(skillMd, 'utf8'))
  if (fm.error) errors.push(fm.error)
  const name = String(fm.data.name ?? '')
  if (!name) errors.push(at('SKILL.md', 'name', 'required'))
  else if (!SKILL_NAME.test(name) || name.length > 64) errors.push(at('SKILL.md', 'name', `"${name}" must be lowercase words joined by dashes (e.g. research-kit), at most 64 characters`))
  const description = String(fm.data.description ?? '').trim()
  if (!description) errors.push(at('SKILL.md', 'description', 'required — say what the skill does and when to use it'))
  else if (description.length > 1024) errors.push(at('SKILL.md', 'description', 'at most 1024 characters'))
  const meta = isObj(fm.data.metadata) && isObj(fm.data.metadata.aifig) ? (fm.data.metadata.aifig as Json) : null
  const version = String(meta?.version ?? '0.1.0')
  const capability = String(meta?.capability ?? 'L0')
  if (capability === 'L2') errors.push(at('SKILL.md', 'metadata.aifig.capability', 'L2 (sandboxed scripts) is not supported yet — use L0 or L1'))
  else if (capability !== 'L0' && capability !== 'L1') errors.push(at('SKILL.md', 'metadata.aifig.capability', `must be L0 or L1, got "${capability}"`))
  const perms = isObj(meta?.permissions) ? (meta!.permissions as Json) : {}
  const tools = Array.isArray(perms.tools) ? perms.tools.map(String) : []
  for (const k of ['network', 'secrets']) if (Array.isArray(perms[k]) && (perms[k] as unknown[]).length) errors.push(at('SKILL.md', `metadata.aifig.permissions.${k}`, 'only L2 scripts can ask for this, and L2 is not supported yet'))
  if (tools.length && capability === 'L0') errors.push(at('SKILL.md', 'metadata.aifig.permissions.tools', 'an L0 skill cannot call tools — set capability: L1'))
  for (const t of tools) if (!/^[\w-]+\.[\w.-]+$/.test(t)) errors.push(at('SKILL.md', 'metadata.aifig.permissions.tools', `"${t}" is not <server>.<tool> (or aifig.<tool>)`))
  for (const t of tools) if (t.startsWith('aifig.') && !(BUILTIN_SKILL_TOOLS as readonly string[]).includes(t)) errors.push(at('SKILL.md', 'metadata.aifig.permissions.tools', `"${t}" is not a built-in tool skills can use (${BUILTIN_SKILL_TOOLS.join(', ')})`))

  let canvas = empty
  if (meta?.canvas) {
    const rel = String(meta.canvas)
    const file = path.join(dir, rel)
    if (!fs.existsSync(file)) errors.push(at('SKILL.md', 'metadata.aifig.canvas', `${rel} not found`))
    else {
      let raw: unknown
      try {
        raw = JSON.parse(fs.readFileSync(file, 'utf8'))
      } catch (e) {
        errors.push(at(rel, '', `not valid JSON — ${(e as Error).message}`))
      }
      if (raw !== undefined) canvas = parseCanvas(raw, name || path.basename(dir), dir, path.dirname(file), rel, tools, errors, warnings)
    }
  }
  if (capability === 'L1' && !tools.length) warnings.push(at('SKILL.md', 'metadata.aifig.capability', 'L1 without any permissions.tools — did you mean L0?'))
  return { name: name || path.basename(dir), description, version, capability: capability === 'L1' ? 'L1' : 'L0', permissions: { tools }, instructions: fm.body, canvas, source, path: dir, errors, warnings }
}

function parseCanvas(raw: unknown, skill: string, skillDir: string, canvasDir: string, file: string, tools: string[], errors: string[], warnings: string[]): SkillCanvas {
  const at = (where: string, msg: string) => `${file} › ${where}: ${msg}`
  const out: SkillCanvas = { types: [], layouts: [], actions: [], prompts: [] }
  if (!isObj(raw)) {
    errors.push(at('(root)', 'must be an object with "types", "layouts", "actions", "prompts"'))
    return out
  }
  const typeEntries: [string, unknown][] = Array.isArray(raw.types) ? raw.types.map((t, i) => [String((t as Json)?.id ?? `#${i}`), t]) : isObj(raw.types) ? Object.entries(raw.types) : []
  if (raw.types !== undefined && !typeEntries.length && !(Array.isArray(raw.types) && !raw.types.length)) errors.push(at('types', 'must be an object keyed by type id (or an array with "id")'))
  // a skill's own types are always namespaced; bare references mean its own type first, then a built-in one
  const own = (id: string) => (id.includes('.') ? id : `${skill}.${id}`)
  const localIds = new Set(typeEntries.map(([id]) => own(id)))
  const qualify = (id: string) => (id.includes('.') ? id : localIds.has(`${skill}.${id}`) ? `${skill}.${id}` : id in BUILTIN_TYPES ? id : `${skill}.${id}`)
  for (const [localId, t] of typeEntries) {
    const w = `types.${localId}`
    if (!isObj(t)) {
      errors.push(at(w, 'must be an object'))
      continue
    }
    if (!/^[a-z][\w-]*$/.test(localId)) errors.push(at(w, 'type ids are lowercase letters, digits, - and _'))
    const label = String(t.label ?? '')
    if (!label) errors.push(at(`${w}.label`, 'required'))
    const color = String(t.color ?? 'gray')
    if (!(COLOR_TOKENS as readonly string[]).includes(color)) errors.push(at(`${w}.color`, `"${color}" is not a color token (${COLOR_TOKENS.join(', ')})`))
    const icon = String(t.icon ?? 'Tag')
    if (!(SKILL_ICONS as readonly string[]).includes(icon)) warnings.push(at(`${w}.icon`, `"${icon}" is not in the icon set; it will show as a tag. Icons: ${SKILL_ICONS.join(', ')}`))
    const base = t.base === 'card' ? 'card' : 'sticky'
    if (t.base !== undefined && t.base !== 'card' && t.base !== 'sticky') errors.push(at(`${w}.base`, 'must be "sticky" or "card"'))
    const fields: FieldDef[] = []
    const rawFields = Array.isArray(t.fields) ? t.fields : []
    if (t.fields !== undefined && !Array.isArray(t.fields)) errors.push(at(`${w}.fields`, 'must be an array'))
    if (rawFields.length > MAX_SKILL_TYPE_FIELDS) errors.push(at(`${w}.fields`, `at most ${MAX_SKILL_TYPE_FIELDS} fields per type — keep blocks small; long-form content belongs in the text`))
    rawFields.forEach((f, i) => {
      const fw = `${w}.fields[${i}]`
      if (!isObj(f)) return void errors.push(at(fw, 'must be an object'))
      const key = String(f.key ?? '')
      if (!/^[a-z][\w]*$/i.test(key)) errors.push(at(`${fw}.key`, `"${key}" must be a plain identifier`))
      const kind = f.kind ?? 'text'
      if (!isFieldKind(kind)) return void errors.push(at(`${fw}.kind`, `must be text, number, enum or boolean (got "${String(kind)}")`))
      const flabel = String(f.label ?? key)
      if (kind === 'enum') {
        const options = Array.isArray(f.options) ? f.options.map((o) => String(o).toLowerCase()) : []
        if (options.length < 2) errors.push(at(`${fw}.options`, 'an enum needs at least two options'))
        if (f.default !== undefined && !options.includes(String(f.default).toLowerCase())) errors.push(at(`${fw}.default`, `"${f.default}" is not one of the options`))
        fields.push({ key, label: flabel, kind, options, default: f.default !== undefined ? String(f.default).toLowerCase() : undefined })
      } else if (kind === 'number') fields.push({ key, label: flabel, kind, default: typeof f.default === 'number' ? f.default : undefined, unit: f.unit ? String(f.unit) : undefined })
      else if (kind === 'boolean') fields.push({ key, label: flabel, kind, default: typeof f.default === 'boolean' ? f.default : undefined })
      else fields.push({ key, label: flabel, kind, placeholder: f.placeholder ? String(f.placeholder) : undefined })
    })
    const keys = new Set(fields.map((f) => f.key))
    if (keys.size !== fields.length) errors.push(at(`${w}.fields`, 'field keys must be unique'))
    const tpl = isObj(t.template) ? t.template : undefined
    const rows = Array.isArray(tpl?.rows) ? tpl!.rows.map(String) : undefined
    const summary = Array.isArray(tpl?.summary) ? tpl!.summary.map(String) : undefined
    for (const k of [...(rows ?? []), ...(summary ?? [])]) if (!keys.has(k)) errors.push(at(`${w}.template`, `"${k}" is not one of this type's fields`))
    const def: BlockTypeDef = {
      id: own(localId),
      label,
      plural: String(t.plural ?? `${label}s`),
      color: color as ColorToken,
      icon,
      glyph: String(t.glyph ?? '•').slice(0, 2),
      description: String(t.description ?? ''),
      fields,
      prefixes: Array.isArray(t.prefixes) ? t.prefixes.map(String).filter((p) => p.length >= 2) : [],
      skill,
      base,
      template: rows || summary ? { rows, summary } : undefined,
      relations: {},
    }
    out.types.push(def)
  }
  if (Array.isArray(raw.relations)) {
    raw.relations.forEach((r, i) => {
      if (!isObj(r)) return void errors.push(at(`relations[${i}]`, 'must be { "from", "to", "relation" }'))
      const from = qualify(String(r.from ?? ''))
      const to = qualify(String(r.to ?? ''))
      const relation = String(r.relation ?? '')
      const def = out.types.find((t) => t.id === from)
      if (!def) return void errors.push(at(`relations[${i}].from`, `"${r.from}" is not a type of this skill`))
      if (!localIds.has(to) && !(to in BUILTIN_TYPES)) errors.push(at(`relations[${i}].to`, `"${r.to}" is neither a type of this skill nor a built-in type`))
      if (!/^[a-z][a-z -]{1,24}$/.test(relation)) errors.push(at(`relations[${i}].relation`, 'a short lowercase verb, e.g. "supports" or "competes with"'))
      ;(def.relations as Record<string, Relation>)[to] = relation
    })
  }
  if (Array.isArray(raw.layouts)) {
    raw.layouts.forEach((l, i) => {
      const w = `layouts[${i}]`
      if (!isObj(l)) return void errors.push(at(w, 'must be an object'))
      const intent = String(l.intent ?? '')
      if (!(LAYOUT_INTENTS as readonly string[]).includes(intent)) return void errors.push(at(`${w}.intent`, `must be one of ${LAYOUT_INTENTS.join(', ')}`))
      const layout: SkillLayout = { id: String(l.id ?? ''), label: String(l.label ?? l.id ?? ''), intent: intent as SkillLayout['intent'], description: l.description ? String(l.description) : undefined, types: Array.isArray(l.types) ? l.types.map((t) => qualify(String(t))) : undefined, rows: l.rows ? String(l.rows) : undefined, cols: l.cols ? String(l.cols) : undefined, field: l.field ? String(l.field) : undefined }
      if (!/^[a-z][\w-]*$/.test(layout.id)) errors.push(at(`${w}.id`, 'required, lowercase'))
      if (intent === 'matrix' && (!layout.rows || !layout.cols)) errors.push(at(w, 'a matrix needs "rows" and "cols" (field keys, or "type" for rows)'))
      if (intent === 'timeline' && !layout.field) errors.push(at(w, 'a timeline needs "field" (the date field)'))
      for (const t of layout.types ?? []) if (!localIds.has(t) && !(t in BUILTIN_TYPES)) errors.push(at(`${w}.types`, `"${t}" is not a known type`))
      out.layouts.push(layout)
    })
  }
  if (Array.isArray(raw.actions)) {
    raw.actions.forEach((a, i) => {
      const w = `actions[${i}]`
      if (!isObj(a)) return void errors.push(at(w, 'must be an object'))
      const tool = String(a.tool ?? '')
      if (!tools.includes(tool)) errors.push(at(`${w}.tool`, `"${tool}" must be listed in SKILL.md metadata.aifig.permissions.tools`))
      const o = isObj(a.output) ? a.output : { mode: 'blocks' }
      const output: SkillAction['output'] = o.mode === 'field' ? { mode: 'field', field: String(o.field ?? '') } : { mode: 'blocks', type: o.type ? qualify(String(o.type)) : undefined, relation: o.relation ? String(o.relation) : undefined }
      if (output.mode === 'blocks' && output.type && !localIds.has(output.type) && !(output.type in BUILTIN_TYPES)) errors.push(at(`${w}.output.type`, `"${o.type}" is not a known type`))
      out.actions.push({ id: String(a.id ?? ''), label: String(a.label ?? a.id ?? ''), description: a.description ? String(a.description) : undefined, tool, args: isObj(a.args) ? a.args : {}, appliesTo: Array.isArray(a.appliesTo) ? a.appliesTo.map((t) => qualify(String(t))) : undefined, output })
      if (!/^[a-z][\w-]*$/.test(String(a.id ?? ''))) errors.push(at(`${w}.id`, 'required, lowercase'))
    })
  }
  if (Array.isArray(raw.prompts)) {
    raw.prompts.forEach((p, i) => {
      const w = `prompts[${i}]`
      if (!isObj(p)) return void errors.push(at(w, 'must be an object'))
      let text = p.text ? String(p.text) : ''
      if (p.file) {
        const f = path.resolve(canvasDir, String(p.file))
        if (!f.startsWith(path.resolve(skillDir))) errors.push(at(`${w}.file`, 'must stay inside the skill folder'))
        else if (!fs.existsSync(f)) errors.push(at(`${w}.file`, `${p.file} not found`))
        else text = fs.readFileSync(f, 'utf8')
      }
      out.prompts.push({ id: String(p.id ?? ''), label: String(p.label ?? p.id ?? ''), description: p.description ? String(p.description) : undefined, text } satisfies SkillPrompt)
    })
  }
  for (const k of Object.keys(raw)) if (!['$schema', 'version', 'types', 'relations', 'layouts', 'actions', 'prompts'].includes(k)) warnings.push(at(k, 'unknown key (ignored)'))
  return out
}

const here = path.dirname(fileURLToPath(import.meta.url))

/** Folders with built-in skills: next to the CLI (repo / npm), or wherever the desktop app put them. */
export function builtinSkillsDir() {
  const candidates = [process.env.AIFIG_BUILTIN_SKILLS, path.resolve(here, '../../../skills/builtin'), path.resolve(path.dirname(process.argv[1] ?? '.'), '../skills/builtin'), path.resolve(process.cwd(), 'skills/builtin')]
  return candidates.find((c) => c && fs.existsSync(c)) ?? null
}

export const userSkillsDir = () => path.join(aifigHome(), 'skills')

/** Every skill this machine knows: built-in, installed in ~/.aifig/skills, and folders registered with `aifig skill dev`. */
export class SkillLibrary {
  private devPaths = new Set<string>()

  list(): SkillManifest[] {
    const found = new Map<string, SkillManifest>()
    const scan = (dir: string | null, source: SkillManifest['source']) => {
      if (!dir || !fs.existsSync(dir)) return
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue
        const s = loadSkill(path.join(dir, e.name), source)
        found.set(s.name, s)
      }
    }
    scan(builtinSkillsDir(), 'builtin')
    scan(userSkillsDir(), 'user')
    for (const p of this.devPaths) {
      const s = loadSkill(p, 'dev')
      found.set(s.name, s)
    }
    return [...found.values()].sort((a, b) => (a.source === 'builtin' ? 0 : 1) - (b.source === 'builtin' ? 0 : 1) || a.name.localeCompare(b.name))
  }

  get(name: string): SkillManifest | undefined {
    return this.list().find((s) => s.name === name)
  }

  /** Register a folder for live development; returns its current validation. */
  dev(dir: string) {
    const abs = path.resolve(dir)
    this.devPaths.add(abs)
    return loadSkill(abs, 'dev')
  }

  /** Copy a skill folder into ~/.aifig/skills after validating it. */
  install(dir: string) {
    const src = path.resolve(dir)
    const s = loadSkill(src, 'user')
    if (s.errors.length) return s
    const dest = path.join(userSkillsDir(), s.name)
    fs.rmSync(dest, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.cpSync(src, dest, { recursive: true, filter: (p) => !/(^|\/)(node_modules|\.git)(\/|$)/.test(p) })
    return loadSkill(dest, 'user')
  }
}

/** Write a skill folder: SKILL.md + canvas/blocks.json (used by `aifig skill new` and "Save as block type"). */
export function writeSkillFolder(dir: string, s: { name: string; description: string; version?: string; capability?: 'L0' | 'L1'; tools?: string[]; instructions: string; blocks: Json }) {
  fs.mkdirSync(path.join(dir, 'canvas'), { recursive: true })
  const meta = { version: s.version ?? '0.1.0', canvas: 'canvas/blocks.json', capability: s.capability ?? 'L0', ...(s.tools?.length ? { permissions: { tools: s.tools } } : {}) }
  const fm = yaml.dump({ name: s.name, description: s.description, metadata: { aifig: meta } }, { lineWidth: 100 })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${fm}---\n\n${s.instructions.trim()}\n`)
  fs.writeFileSync(path.join(dir, 'canvas/blocks.json'), `${JSON.stringify({ $schema: 'https://aifig.dev/schemas/skill-blocks-1.json', version: 1, ...s.blocks }, null, 2)}\n`)
}
