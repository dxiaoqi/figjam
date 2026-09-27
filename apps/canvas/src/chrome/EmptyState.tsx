import { ArrowRight, Loader2, Plug } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { TemplateId } from '@aifig/shared'
import { Button } from '@/components/ui/button'
import { useBlockCount, useBoard, useBoardTitle, useProviderState } from '../board-context'
import { useEditorState } from '../canvas/editor-context'
import { callCore } from '../lib/core'
import { getLocale, useT, type MessageKey } from '../i18n'
import { ScenarioChips, TemplateTile } from './NewBoardDialog'
import { openNewBoard } from './new-board'

const KEYS: [string, MessageKey, string][] = [
  ['S', 'tool.stickyShort', 'sticky'],
  ['C', 'tool.card', 'card'],
  ['T', 'tool.text', 'text'],
  ['F', 'tool.frame', 'frame'],
  ['A', 'tool.connectShort', 'connector'],
]

const SUGGESTED: TemplateId[] = ['research-synthesis', 'brainstorm', 'meeting-notes']
const DEFAULT_TITLES = new Set(['Untitled board', '未命名画板', 'My first board'])

export function EmptyState() {
  const editor = useEditorState()
  const count = useBlockCount()
  const { synced } = useProviderState()
  const { boardId, theme, refreshBoards } = useBoard()
  const title = useBoardTitle()
  const t = useT()
  const [applying, setApplying] = useState<TemplateId | null>(null)
  const busy = editor.tool !== 'select' || editor.editingId !== null
  if (!synced || (count > 0 && !applying) || busy) return null

  const apply = async (template: TemplateId) => {
    setApplying(template)
    try {
      await callCore('apply_template', { board: boardId, template, language: getLocale(), rename: DEFAULT_TITLES.has(title) || !title })
      refreshBoards()
      setTimeout(() => editor.zoomToFit(), 120)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setApplying(null)
    }
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-[200] flex items-center justify-center p-4 max-sm:items-start max-sm:pt-20">
      <div className="chrome pointer-events-auto w-[480px] max-w-full animate-in fade-in zoom-in-95 rounded-3xl p-6 duration-300 sm:p-7" data-empty-state>
        <div className="mb-5 flex gap-1.5">
          <div className="h-9 w-9 rotate-[-4deg] rounded-[4px] bg-[#FFF1B8] shadow-sm dark:bg-[#4A4128]" />
          <div className="h-9 w-9 rotate-[3deg] rounded-[4px] bg-[#E8DEFF] shadow-sm dark:bg-[#3A3150]" />
          <div className="h-9 w-9 rotate-[-2deg] rounded-[4px] bg-[#CDF1EC] shadow-sm dark:bg-[#264341]" />
        </div>
        <h2 className="text-lg font-semibold tracking-tight">{t('empty.title')}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t('empty.body')}</p>
        <div className="mt-5 flex flex-wrap gap-1.5">
          {KEYS.map(([k, label, tool]) => (
            <button
              key={k}
              onClick={() => editor.setTool(tool)}
              className="flex items-center gap-1.5 rounded-lg border bg-background/60 px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <kbd className="rounded bg-muted px-1.5 font-mono text-[10px] text-foreground">{k}</kbd>
              {t(label)}
            </button>
          ))}
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">{t('empty.templates')}</span>
            <button className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => openNewBoard('blank')} data-empty-all-templates>
              {t('empty.more')} <ArrowRight className="size-3" />
            </button>
          </div>
          <div className="relative grid grid-cols-3 gap-2" data-empty-templates>
            {SUGGESTED.map((id) => (
              <TemplateTile key={id} id={id} theme={theme} compact onSelect={() => !applying && apply(id)} />
            ))}
            {applying && (
              <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-background/60 backdrop-blur-[1px]">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="mt-4 mb-2 text-xs font-medium text-muted-foreground">{t('empty.scenarios')}</div>
          <ScenarioChips />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
          <span className="text-xs text-muted-foreground">{t('empty.dblclick')}</span>
          <Button size="sm" className="gap-1.5" onClick={() => window.dispatchEvent(new Event('aifig:connect'))}>
            <Plug className="size-3.5" /> {t('empty.connect')}
          </Button>
        </div>
      </div>
    </div>
  )
}
