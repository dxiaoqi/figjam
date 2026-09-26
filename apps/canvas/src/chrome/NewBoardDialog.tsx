import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { TEMPLATE_IDS, type TemplateId } from '@aifig/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { ThemeMode } from '../board-context'
import { tn, useT, type MessageKey } from '../i18n'
import { TemplatePreview } from './TemplatePreview'

export type TemplateChoice = TemplateId | 'blank'
export const TEMPLATE_CHOICES: TemplateChoice[] = ['blank', ...TEMPLATE_IDS]

export const templateName = (id: TemplateChoice) => `template.${id}.name` as MessageKey
export const templateDescription = (id: TemplateChoice) => `template.${id}.description` as MessageKey

/** Ask the app to open the new-board dialog, optionally with a template preselected. */
export const openNewBoard = (template?: TemplateChoice) => window.dispatchEvent(new CustomEvent('aifig:new-board', { detail: template }))

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

export function NewBoardDialog({ theme, onCreate }: { theme: ThemeMode; onCreate: (opts: { title?: string; template?: TemplateId }) => Promise<void> }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState<TemplateChoice>('blank')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const on = (e: Event) => {
      const pre = (e as CustomEvent<TemplateChoice | undefined>).detail
      setChoice(pre && TEMPLATE_CHOICES.includes(pre) ? pre : 'blank')
      setTitle('')
      setOpen(true)
    }
    window.addEventListener('aifig:new-board', on)
    return () => window.removeEventListener('aifig:new-board', on)
  }, [])

  const create = async (id = choice) => {
    setBusy(true)
    try {
      await onCreate({ title: title.trim() || undefined, template: id === 'blank' ? undefined : id })
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogContent className="max-h-[calc(100dvh-32px)] overflow-x-hidden overflow-y-auto sm:max-w-3xl [&>*]:min-w-0" data-new-board-dialog>
        <DialogHeader>
          <DialogTitle>{t('newBoard.title')}</DialogTitle>
          <DialogDescription>{t('newBoard.hint')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {TEMPLATE_CHOICES.map((id) => (
            <TemplateTile key={id} id={id} theme={theme} selected={choice === id} onSelect={() => setChoice(id)} onOpen={() => create(id)} />
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-board-title" className="text-xs font-medium text-muted-foreground">
            {t('newBoard.name')}
          </label>
          <Input
            id="new-board-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && create()}
            placeholder={choice === 'blank' ? t('board.untitled') : t(templateName(choice))}
            data-new-board-title
          />
        </div>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <p className="hidden text-xs text-muted-foreground sm:block">
            {tn('newBoard.cli', { cmd: <code className="font-mono text-[11px]">{choice === 'blank' ? 'aifig new-board' : `aifig new-board --template ${choice}`}</code> })}
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
