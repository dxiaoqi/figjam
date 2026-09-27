/** Board templates: ordinary typed blocks laid out by the core's layout engine (content lives in @aifig/core). */
export const TEMPLATE_IDS = [
  'research-synthesis',
  'competitor-analysis',
  'user-journey',
  'brainstorm',
  'meeting-notes',
  'architecture-map',
  'incident-review',
  'interview-synthesis',
  'product-discovery',
  'prototype-wall',
  'literature-review',
] as const
export type TemplateId = (typeof TEMPLATE_IDS)[number]

export const CONTENT_LANGUAGES = ['en', 'zh-CN'] as const
export type ContentLanguage = (typeof CONTENT_LANGUAGES)[number]

export interface TemplateInfo {
  title: Record<ContentLanguage, string>
  description: string
  /** Built-in skill the template's blocks use; creating the board enables it first. */
  skill?: string
}

export const TEMPLATES: Record<TemplateId, TemplateInfo> = {
  'research-synthesis': {
    title: { en: 'Research synthesis', 'zh-CN': '研究综合' },
    description: 'Interview quotes → themed insights → hypotheses and open questions.',
  },
  'competitor-analysis': {
    title: { en: 'Competitor analysis', 'zh-CN': '竞品分析' },
    description: 'Competitor profiles side by side, strengths and gaps, and where to play.',
  },
  'user-journey': {
    title: { en: 'User journey map', 'zh-CN': '用户旅程图' },
    description: 'Journey stages with what people do, feel and struggle with, plus opportunities.',
  },
  brainstorm: {
    title: { en: 'Brainstorm', 'zh-CN': '头脑风暴' },
    description: 'A "how might we" prompt, idea clusters and a shortlist with next steps.',
  },
  'meeting-notes': {
    title: { en: 'Meeting notes', 'zh-CN': '会议纪要' },
    description: 'Agenda, notes, decisions and action items with owners.',
  },
  'architecture-map': {
    title: { en: 'Architecture map', 'zh-CN': '架构地图' },
    description: 'Modules by layer, interface contracts, data stores, decisions (ADRs) and risks. Enables arch-kit.',
    skill: 'arch-kit',
  },
  'incident-review': {
    title: { en: 'Incident review', 'zh-CN': '故障复盘' },
    description: 'A blameless incident timeline with contributing factors and follow-up decisions. Enables arch-kit.',
    skill: 'arch-kit',
  },
  'interview-synthesis': {
    title: { en: 'Interview synthesis', 'zh-CN': '访谈综合' },
    description: 'Interviews → sourced quotes → affinity clusters → insights, opportunities and hypotheses. Enables research-kit.',
    skill: 'research-kit',
  },
  'product-discovery': {
    title: { en: 'Product discovery', 'zh-CN': '产品探索' },
    description: 'Competitor matrix → opportunities → solutions on a priority matrix → experiments → PRD. Enables product-kit.',
    skill: 'product-kit',
  },
  'prototype-wall': {
    title: { en: 'Prototype wall', 'zh-CN': '原型墙' },
    description: 'A brief and interactive HTML variants side by side, with review feedback and a decision. Enables prototype-kit.',
    skill: 'prototype-kit',
  },
  'literature-review': {
    title: { en: 'Literature review', 'zh-CN': '文献综述' },
    description: 'Research questions, papers, claims with evidence and counter-evidence, and gaps. Enables lit-kit.',
    skill: 'lit-kit',
  },
}

/**
 * Scenarios: a use case packaged as a built-in skill (block types, layouts, agent workflow in SKILL.md) plus
 * templates. Picking one enables the skill on a new board and fills it from the first template; an external
 * agent then runs the SKILL.md workflow over MCP.
 */
export const SCENARIO_IDS = ['architecture', 'research', 'product', 'prototype', 'literature'] as const
export type ScenarioId = (typeof SCENARIO_IDS)[number]

export const SCENARIOS: Record<ScenarioId, { skill: string; templates: readonly TemplateId[] }> = {
  architecture: { skill: 'arch-kit', templates: ['architecture-map', 'incident-review'] },
  research: { skill: 'research-kit', templates: ['interview-synthesis'] },
  product: { skill: 'product-kit', templates: ['product-discovery'] },
  prototype: { skill: 'prototype-kit', templates: ['prototype-wall'] },
  literature: { skill: 'lit-kit', templates: ['literature-review'] },
}

export function isTemplateId(v: unknown): v is TemplateId {
  return typeof v === 'string' && (TEMPLATE_IDS as readonly string[]).includes(v)
}
