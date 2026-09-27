import { Check, Copy, FolderOpen, Loader2, Puzzle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { SCENARIO_IDS, SCENARIOS, type ScenarioId, type TemplateId } from '@aifig/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { ThemeMode } from '../board-context'
import { tn, useT } from '../i18n'
import { openNewBoard, SCENARIO_ICONS, scenarioKey, TEMPLATE_CHOICES, templateDescription, templateName, type Preselect, type TemplateChoice } from './new-board'
import { TemplatePreview } from './TemplatePreview'

export function TemplateTile({ id, theme, selected, onSelect, onOpen, compact }: { id: TemplateChoice; theme: ThemeMode; selected?: boolean; onSelect: () => void; onOpen?: () => void; compact?: boolean }) {
  const t = useT()
  return (
    <button
      type="button"
      data-template={id}
      aria-pressed={selected}
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={cn(
        'group flex flex-col overflow-hidden rounded-2xl border bg-background text-left transition-all hover:-translate-y-px hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        selected && 'border-primary ring-1 ring-primary',
      )}
    >
      <TemplatePreview id={id} theme={theme} className="aspect-[16/10] w-full border-b" />
      <div className={cn('flex flex-col gap-0.5', compact ? 'px-2.5 py-2' : 'px-3 py-2.5')}>
        <span className="text-[13px] font-medium">{t(templateName(id))}</span>
        {!compact && <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{t(templateDescription(id))}</span>}
      </div>
    </button>
  )
}

/** One chip per scenario; opens the new-board dialog on it. */
export function ScenarioChips({ onPick, className }: { onPick?: () => void; className?: string }) {
  const t = useT()
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)} data-scenario-chips>
      {SCENARIO_IDS.map((id) => {
        const Icon = SCENARIO_ICONS[id]
        return (
          <button
            key={id}
            type="button"
            data-scenario-chip={id}
            onClick={() => {
              onPick?.()
              openNewBoard(`scenario:${id}`)
            }}
            className="flex items-center gap-1.5 rounded-full border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            <Icon className="size-3" /> {t(scenarioKey(id, 'name'))}
          </button>
        )
      })}
    </div>
  )
}

function ScenarioDetail({ id, template, setTemplate, theme, boardName, onOpenSample, busy }: { id: ScenarioId; template: TemplateId; setTemplate: (t: TemplateId) => void; theme: ThemeMode; boardName: string; onOpenSample: () => void; busy: boolean }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const sc = SCENARIOS[id]
  const prompt = t(scenarioKey(id, 'prompt'), { board: boardName })
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      toast.success(t('newBoard.copied'))
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked: the prompt stays selectable */
    }
  }
  return (
    <div className="flex min-w-0 flex-col gap-4" data-scenario-detail={id}>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <TemplatePreview id={template} theme={theme} className="aspect-[16/10] w-full rounded-2xl border" />
        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">{t('newBoard.workflow')}</div>
          <ol className="flex flex-col gap-2">
            {[1, 2, 3, 4].map((n) => (
              <li key={n} className="flex items-start gap-2.5 text-[13px] leading-snug">
                <span className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold tabular-nums">{n}</span>
                <span>{t(scenarioKey(id, `step${n}`))}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300">
          <Puzzle className="size-3" /> {t('newBoard.enables', { skill: sc.skill })}
        </span>
        {sc.templates.length > 1 &&
          sc.templates.map((tid) => (
            <button
              key={tid}
              type="button"
              data-scenario-template={tid}
              aria-pressed={tid === template}
              onClick={() => setTemplate(tid)}
              className={cn('rounded-full border px-2.5 py-0.5 text-[11px] transition-colors', tid === template ? 'border-foreground bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}
            >
              {t(templateName(tid))}
            </button>
          ))}
      </div>
      <div className="rounded-xl border bg-muted/40 p-3">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">{t('newBoard.askAgent')}</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[11px]" onClick={onOpenSample} disabled={busy} data-open-sample>
              <FolderOpen className="size-3" /> {t('newBoard.openSample')}
            </Button>
            <Button variant="outline" size="sm" className="h-6 gap-1 px-2 text-[11px]" onClick={copy} data-copy-prompt>
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />} {t('newBoard.copyPrompt')}
            </Button>
          </div>
        </div>
        <p className="text-[12.5px] leading-relaxed select-text" data-scenario-prompt>
          {prompt}
        </p>
      </div>
    </div>
  )
}

export function NewBoardDialog({ theme, onCreate, onOpenSample }: { theme: ThemeMode; onCreate: (opts: { title?: string; template?: TemplateId }) => Promise<void>; onOpenSample: (skill: string) => Promise<void> }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'scenarios' | 'templates'>('templates')
  const [choice, setChoice] = useState<TemplateChoice>('blank')
  const [scenario, setScenario] = useState<ScenarioId>('architecture')
  const [scenarioTemplate, setScenarioTemplate] = useState<TemplateId>(SCENARIOS.architecture.templates[0])
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const pickScenario = (id: ScenarioId) => {
    setScenario(id)
    setScenarioTemplate(SCENARIOS[id].templates[0])
  }

  useEffect(() => {
    const on = (e: Event) => {
      const pre = (e as CustomEvent<Preselect | undefined>).detail
      const sc = typeof pre === 'string' && pre.startsWith('scenario:') ? (pre.slice(9) as ScenarioId) : null
      const scenarioOf = pre && !sc ? SCENARIO_IDS.find((id) => SCENARIOS[id].templates.includes(pre as TemplateId)) : undefined
      if (sc && SCENARIO_IDS.includes(sc)) {
        setTab('scenarios')
        pickScenario(sc)
      } else if (scenarioOf) {
        setTab('scenarios')
        setScenario(scenarioOf)
        setScenarioTemplate(pre as TemplateId)
      } else if (pre && TEMPLATE_CHOICES.includes(pre as TemplateChoice)) {
        setTab('templates')
        setChoice(pre as TemplateChoice)
      } else {
        setTab('templates')
        setChoice('blank')
      }
      setTitle('')
      setOpen(true)
    }
    window.addEventListener('aifig:new-board', on)
    return () => window.removeEventListener('aifig:new-board', on)
  }, [])

  const selected: TemplateChoice = tab === 'scenarios' ? scenarioTemplate : choice
  const create = async (id = selected) => {
    setBusy(true)
    try {
      await onCreate({ title: title.trim() || undefined, template: id === 'blank' ? undefined : id })
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }
  const openSample = async () => {
    setBusy(true)
    try {
      await onOpenSample(SCENARIOS[scenario].skill)
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }
  const placeholder = selected === 'blank' ? t('board.untitled') : t(templateName(selected))

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogContent className="max-h-[calc(100dvh-32px)] overflow-x-hidden overflow-y-auto sm:max-w-4xl [&>*]:min-w-0" data-new-board-dialog data-new-board-tab={tab}>
        <DialogHeader>
          <DialogTitle>{t('newBoard.title')}</DialogTitle>
          <DialogDescription>{t(tab === 'scenarios' ? 'newBoard.scenarioHint' : 'newBoard.hint')}</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="templates" data-new-board-tab-trigger="templates">
              {t('newBoard.tabTemplates')}
            </TabsTrigger>
            <TabsTrigger value="scenarios" data-new-board-tab-trigger="scenarios">
              {t('newBoard.tabScenarios')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {tab === 'scenarios' ? (
          <div className="grid gap-5 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]" data-scenarios>
            <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-col sm:overflow-visible sm:pb-0" role="listbox" aria-label={t('newBoard.tabScenarios')}>
              {SCENARIO_IDS.map((id) => {
                const Icon = SCENARIO_ICONS[id]
                const on = id === scenario
                return (
                  <button
                    key={id}
                    type="button"
                    role="option"
                    aria-selected={on}
                    data-scenario={id}
                    onClick={() => pickScenario(id)}
                    onDoubleClick={() => create(SCENARIOS[id].templates[0])}
                    className={cn(
                      'flex w-56 shrink-0 items-start gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:w-auto',
                      on ? 'border-primary bg-primary/[0.04] ring-1 ring-primary' : 'hover:bg-accent/60',
                    )}
                  >
                    <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg', on ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                      <Icon className="size-3.5" />
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[13px] font-medium">{t(scenarioKey(id, 'name'))}</span>
                      <span className="text-xs leading-snug text-muted-foreground">{t(scenarioKey(id, 'tagline'))}</span>
                    </span>
                  </button>
                )
              })}
            </div>
            <ScenarioDetail id={scenario} template={scenarioTemplate} setTemplate={setScenarioTemplate} theme={theme} boardName={title.trim() || placeholder} onOpenSample={openSample} busy={busy} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-templates>
            {TEMPLATE_CHOICES.map((id) => (
              <TemplateTile key={id} id={id} theme={theme} selected={choice === id} onSelect={() => setChoice(id)} onOpen={() => create(id)} />
            ))}
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-board-title" className="text-xs font-medium text-muted-foreground">
            {t('newBoard.name')}
          </label>
          <Input
            id="new-board-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && create()}
            placeholder={placeholder}
            data-new-board-title
          />
        </div>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <p className="hidden text-xs text-muted-foreground sm:block">
            {tn('newBoard.cli', { cmd: <code className="font-mono text-[11px]">{selected === 'blank' ? 'aifig new-board' : `aifig new-board --template ${selected}`}</code> })}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => create()} disabled={busy} data-new-board-create>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              {t(busy ? 'newBoard.creating' : 'newBoard.create')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
