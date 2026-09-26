import {
  Blocks,
  BookOpen,
  Boxes,
  CircleHelp,
  Compass,
  Database,
  FileCode2,
  FileText,
  FlaskConical,
  Gauge,
  Gavel,
  Lightbulb,
  ListChecks,
  type LucideIcon,
  MessageSquareQuote,
  MessageSquareText,
  Microscope,
  Network,
  PanelsTopLeft,
  Plug,
  Scale,
  ServerCog,
  ShieldAlert,
  Sparkles,
  Swords,
  Target,
  TriangleAlert,
  Users,
} from 'lucide-react'

export type TokenColor = 'yellow' | 'orange' | 'red' | 'pink' | 'purple' | 'blue' | 'teal' | 'green' | 'gray'

export const scenarioSlugs = ['architecture', 'user-research', 'product-discovery', 'prototype-wall', 'literature-review'] as const
export type ScenarioSlug = (typeof scenarioSlugs)[number]

export function isScenario(v: string): v is ScenarioSlug {
  return (scenarioSlugs as readonly string[]).includes(v)
}

type BlockStyle = { color: TokenColor; icon: LucideIcon }

/**
 * The Skill behind each scenario and the look of its block types. Labels and copy live in the dictionaries
 * (`scenarios.items.<slug>.blocks`, same order as `blocks` here).
 */
export const scenarios: Record<ScenarioSlug, { skill: string; color: TokenColor; icon: LucideIcon; blocks: readonly BlockStyle[] }> = {
  architecture: {
    skill: 'arch-kit',
    color: 'blue',
    icon: Network,
    blocks: [
      { color: 'blue', icon: Boxes },
      { color: 'teal', icon: ServerCog },
      { color: 'purple', icon: Plug },
      { color: 'gray', icon: Database },
      { color: 'orange', icon: Blocks },
      { color: 'green', icon: Gavel },
      { color: 'red', icon: ShieldAlert },
    ],
  },
  'user-research': {
    skill: 'research-kit',
    color: 'yellow',
    icon: Users,
    blocks: [
      { color: 'gray', icon: Users },
      { color: 'yellow', icon: MessageSquareQuote },
      { color: 'purple', icon: Lightbulb },
      { color: 'green', icon: Target },
      { color: 'orange', icon: FlaskConical },
    ],
  },
  'product-discovery': {
    skill: 'product-kit',
    color: 'green',
    icon: Compass,
    blocks: [
      { color: 'blue', icon: Swords },
      { color: 'green', icon: Target },
      { color: 'teal', icon: Sparkles },
      { color: 'orange', icon: FlaskConical },
      { color: 'purple', icon: Gauge },
      { color: 'gray', icon: ListChecks },
    ],
  },
  'prototype-wall': {
    skill: 'prototype-kit',
    color: 'pink',
    icon: PanelsTopLeft,
    blocks: [
      { color: 'blue', icon: FileCode2 },
      { color: 'yellow', icon: MessageSquareText },
      { color: 'green', icon: Gavel },
    ],
  },
  'literature-review': {
    skill: 'lit-kit',
    color: 'purple',
    icon: BookOpen,
    blocks: [
      { color: 'gray', icon: FileText },
      { color: 'purple', icon: Scale },
      { color: 'teal', icon: Microscope },
      { color: 'red', icon: TriangleAlert },
      { color: 'yellow', icon: CircleHelp },
    ],
  },
}
