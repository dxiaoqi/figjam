import { BookOpen, MessagesSquare, PanelsTopLeft, Target, Workflow, type LucideIcon } from 'lucide-react'
import { TEMPLATE_IDS, TEMPLATES, type ScenarioId, type TemplateId } from '@aifig/shared'
import type { MessageKey } from '../i18n'

export type TemplateChoice = TemplateId | 'blank'
/** The Templates tab: blank and the general-purpose templates (scenario templates live under Scenarios). */
export const TEMPLATE_CHOICES: TemplateChoice[] = ['blank', ...TEMPLATE_IDS.filter((id) => !TEMPLATES[id].skill)]

export const templateName = (id: TemplateChoice) => `template.${id}.name` as MessageKey
export const templateDescription = (id: TemplateChoice) => `template.${id}.description` as MessageKey
export const scenarioKey = (id: ScenarioId, k: string) => `scenario.${id}.${k}` as MessageKey

export const SCENARIO_ICONS: Record<ScenarioId, LucideIcon> = { architecture: Workflow, research: MessagesSquare, product: Target, prototype: PanelsTopLeft, literature: BookOpen }

export type Preselect = TemplateChoice | `scenario:${ScenarioId}`

/** Ask the app to open the new-board dialog, optionally with a template or a scenario (`scenario:<id>`) preselected. */
export const openNewBoard = (pre?: Preselect) => window.dispatchEvent(new CustomEvent('aifig:new-board', { detail: pre }))
