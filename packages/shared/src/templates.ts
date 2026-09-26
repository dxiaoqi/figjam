/** Board templates: ordinary typed blocks laid out by the core's layout engine (content lives in @aifig/core). */
export const TEMPLATE_IDS = ['research-synthesis', 'competitor-analysis', 'user-journey', 'brainstorm', 'meeting-notes'] as const
export type TemplateId = (typeof TEMPLATE_IDS)[number]

export const CONTENT_LANGUAGES = ['en', 'zh-CN'] as const
export type ContentLanguage = (typeof CONTENT_LANGUAGES)[number]

export const TEMPLATES: Record<TemplateId, { title: Record<ContentLanguage, string>; description: string }> = {
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
}

export function isTemplateId(v: unknown): v is TemplateId {
  return typeof v === 'string' && (TEMPLATE_IDS as readonly string[]).includes(v)
}
