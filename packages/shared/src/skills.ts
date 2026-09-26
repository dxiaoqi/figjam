import type { ColorToken } from './tokens'
import { BUILTIN_TYPES, type BlockTypeDef, type FieldDef, type Relation, type TypeId, type TypeRegistry } from './types'

/**
 * Skills (§3): an Agent Skill folder (SKILL.md with `name` + `description`) plus an optional canvas extension
 * declared in `metadata.aifig` and defined in `canvas/blocks.json`: block types, card templates, layouts,
 * prompt templates and tool actions. v1 supports L0 (declarative) and L1 (calling tools by name).
 */
export type SkillCapability = 'L0' | 'L1'
export const SKILL_CAPABILITIES = {
  L0: { label: 'Declarative', note: 'Block types, card templates, layouts and instructions. Nothing runs.' },
  L1: { label: 'Uses tools', note: 'Can call the tools it lists (built-in or MCP servers you configured), after you allow it on a board.' },
} as const

export type SkillLayoutIntent = 'grid' | 'matrix' | 'timeline' | 'flow' | 'cluster' | 'type'

export interface SkillLayout {
  id: string
  label: string
  intent: SkillLayoutIntent
  description?: string
  /** Types it arranges (all typed blocks of this skill when omitted). */
  types?: TypeId[]
  /** matrix: field for rows (or "type"), field for columns. */
  rows?: string
  cols?: string
  /** timeline: field holding a date or sortable label. cluster: field to group by. */
  field?: string
}

export interface SkillAction {
  id: string
  label: string
  description?: string
  /** Tool name: `aifig.<canvas tool>` (built-in) or `<mcp server>.<tool>` (configured in ~/.aifig/mcp.json). */
  tool: string
  /** Arguments; strings may use {{text}}, {{title}} and {{fields.<key>}} from each selected block. */
  args?: Record<string, unknown>
  /** Block types it applies to (any block when omitted). */
  appliesTo?: TypeId[]
  /** Where results go: new sticky notes next to the block (default), or a field on the block. */
  output?: { mode: 'blocks'; type?: TypeId; relation?: Relation } | { mode: 'field'; field: string }
}

export interface SkillPrompt {
  id: string
  label: string
  description?: string
  text: string
}

export interface SkillCanvas {
  types: BlockTypeDef[]
  layouts: SkillLayout[]
  actions: SkillAction[]
  prompts: SkillPrompt[]
}

export interface SkillManifest {
  name: string
  description: string
  version: string
  capability: SkillCapability
  permissions: { tools: string[] }
  /** SKILL.md body: instructions for agents (external and built-in). */
  instructions: string
  canvas: SkillCanvas
  source: 'builtin' | 'user' | 'dev' | 'board'
  path?: string
  /** Validation problems (a skill with errors can't be enabled). */
  errors: string[]
  warnings: string[]
}

/** What a board keeps of an enabled skill: enough to render its types and follow its rules without the folder. */
export type BoardSkill = Omit<SkillManifest, 'errors' | 'warnings' | 'path'> & { enabledAt: number; enabledBy: string }

export function skillTypeRegistry(skills: Iterable<Pick<BoardSkill, 'canvas'>>): TypeRegistry {
  const out: Record<TypeId, BlockTypeDef> = { ...BUILTIN_TYPES }
  for (const s of skills) for (const t of s.canvas.types) out[t.id] = t
  return out
}

export const SKILL_ICONS = [
  'Sparkles', 'CircleHelp', 'Quote', 'FlaskConical', 'Lightbulb', 'SquareCheck', 'Tag', 'User', 'Users', 'Building2', 'Store', 'Swords',
  'Target', 'Flag', 'Star', 'Heart', 'ThumbsUp', 'ThumbsDown', 'AlertTriangle', 'Bug', 'Rocket', 'Calendar', 'Clock', 'MapPin',
  'DollarSign', 'ChartBar', 'TrendingUp', 'Layers', 'Link', 'FileText', 'BookOpen', 'MessageSquare', 'Mic', 'Search', 'Puzzle', 'Package',
] as const
export type SkillIcon = (typeof SKILL_ICONS)[number]

/** Built-in tools a skill may call by name (the Canvas API, acting as the skill, through review). */
export const BUILTIN_SKILL_TOOLS = ['aifig.create_blocks', 'aifig.get_board', 'aifig.query_blocks', 'aifig.connect', 'aifig.export_board'] as const

export const isFieldKind = (k: unknown): k is FieldDef['kind'] => k === 'text' || k === 'number' || k === 'enum' || k === 'boolean'
export const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/

export type { ColorToken }

