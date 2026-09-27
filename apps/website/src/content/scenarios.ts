import {
  BookOpen,
  Boxes,
  CalendarClock,
  CircleHelp,
  ClipboardList,
  Compass,
  Database,
  FileText,
  FlaskConical,
  Gauge,
  Gavel,
  Grid3x3,
  Lightbulb,
  ListChecks,
  type LucideIcon,
  MessageSquareQuote,
  MessageSquareText,
  Microscope,
  Network,
  Package,
  PanelsTopLeft,
  Plug,
  Rocket,
  Scale,
  SearchX,
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
 * Each scenario is a built-in Skill plus a board template (skills/builtin/<skill>, New board ▸ Scenarios).
 * Block labels and copy live in the dictionaries (`scenarios.items.<slug>.blocks`, same order as `blocks` here).
 */
export const scenarios: Record<ScenarioSlug, { skill: string; template: string; color: TokenColor; icon: LucideIcon; blocks: readonly BlockStyle[] }> = {
  architecture: {
    skill: 'arch-kit',
    template: 'architecture-map',
    color: 'blue',
    icon: Network,
    blocks: [
      { color: 'blue', icon: Boxes },
      { color: 'purple', icon: ServerCog },
      { color: 'teal', icon: Plug },
      { color: 'orange', icon: Database },
      { color: 'gray', icon: Package },
      { color: 'green', icon: Gavel },
      { color: 'red', icon: ShieldAlert },
      { color: 'yellow', icon: CalendarClock },
    ],
  },
  'user-research': {
    skill: 'research-kit',
    template: 'interview-synthesis',
    color: 'yellow',
    icon: Users,
    blocks: [
      { color: 'blue', icon: Users },
      { color: 'teal', icon: MessageSquareQuote },
      { color: 'purple', icon: Lightbulb },
      { color: 'green', icon: Target },
      { color: 'orange', icon: FlaskConical },
    ],
  },
  'product-discovery': {
    skill: 'product-kit',
    template: 'product-discovery',
    color: 'green',
    icon: Compass,
    blocks: [
      { color: 'blue', icon: Swords },
      { color: 'yellow', icon: Grid3x3 },
      { color: 'pink', icon: Rocket },
      { color: 'green', icon: Target },
      { color: 'purple', icon: Sparkles },
      { color: 'orange', icon: FlaskConical },
      { color: 'teal', icon: Gauge },
      { color: 'gray', icon: ListChecks },
    ],
  },
  'prototype-wall': {
    skill: 'prototype-kit',
    template: 'prototype-wall',
    color: 'pink',
    icon: PanelsTopLeft,
    blocks: [
      { color: 'blue', icon: ClipboardList },
      { color: 'purple', icon: PanelsTopLeft },
      { color: 'yellow', icon: MessageSquareText },
      { color: 'green', icon: Gavel },
    ],
  },
  'literature-review': {
    skill: 'lit-kit',
    template: 'literature-review',
    color: 'purple',
    icon: BookOpen,
    blocks: [
      { color: 'orange', icon: CircleHelp },
      { color: 'blue', icon: FileText },
      { color: 'purple', icon: Scale },
      { color: 'teal', icon: Microscope },
      { color: 'red', icon: TriangleAlert },
      { color: 'yellow', icon: SearchX },
    ],
  },
}
