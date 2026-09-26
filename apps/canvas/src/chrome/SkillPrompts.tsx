import { Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { COLOR_TOKENS, COLORS, SKILL_ICONS, type FieldDef } from '@aifig/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useBoard } from '../board-context'
import { useEditor } from '../canvas/editor-context'
import { iconByName } from '../canvas/type-registry'
import { callCore } from '../lib/core'
import { S } from '../lib/strings'

/** Guess fields from “Key: value” lines, like the core does, so the dialog can show and edit them first. */
function guessFields(text: string): FieldDef[] {
  const out: FieldDef[] = []
  for (const line of text.replace(/[*_`]/g, '').split('\n')) {
    const m = line.match(/^\s*(?:[-*•]\s*)?([A-Za-z\u4e00-\u9fff][\w \u4e00-\u9fff/&-]{0,30}?)\s*[:：]\s*(.+)$/)
    if (!m || out.length >= 8) continue
    const label = m[1].trim()
    const key = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `field${out.length + 1}`
    if (out.some((f) => f.key === key)) continue
    const v = m[2].trim()
    if (/^(yes|no|true|false)$/i.test(v)) out.push({ key, label, kind: 'boolean' })
    else if (/^[$€£¥]?-?[\d,.]+(\/\w+)?$/.test(v.replace(/\s/g, ''))) out.push({ key, label, kind: 'number' })
    else out.push({ key, label, kind: 'text' })
  }
  return out
}

/** No-code “Save as block type”: name it, check the fields, save a standard skill folder and enable it. */
export function SaveTypeDialog() {
  const editor = useEditor()
  const { boardId } = useBoard()
  const [blockId, setBlockId] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [color, setColor] = useState<string>('blue')
  const [icon, setIcon] = useState<string>('Tag')
  const [fields, setFields] = useState<FieldDef[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      const b = editor.block(id)
      if (!b) return
      setBlockId(id)
      setLabel(b.kind === 'card' && b.title ? b.title.split(/[\s—:-]/)[0] : '')
      setColor(b.color)
      setIcon('Tag')
      setFields(guessFields(b.text))
    }
    window.addEventListener('aifig:save-type', on)
    return () => window.removeEventListener('aifig:save-type', on)
  }, [editor])
  const save = async () => {
    if (!blockId) return
    setBusy(true)
    try {
      const r = await callCore<{ type: string; skill: string; export: string }>('save_block_type', { board: boardId, block: blockId, label: label.trim(), color, icon, fields })
      toast.success(S.skills.saved(label.trim()), {
        description: `${r.type} · ~/.aifig/skills/${r.skill}`,
        action: { label: S.skills.download, onClick: () => window.open(r.export, '_blank') },
      })
      setBlockId(null)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const setField = (i: number, patch: Partial<FieldDef>) => setFields(fields.map((f, j) => (j === i ? ({ ...f, ...patch } as FieldDef) : f)))
  return (
    <Dialog open={!!blockId} onOpenChange={(o) => !o && setBlockId(null)}>
      <DialogContent className="sm:max-w-lg" data-save-type-dialog>
        <DialogHeader>
          <DialogTitle>{S.skills.saveTitle}</DialogTitle>
          <DialogDescription>{S.skills.saveDescription}</DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1 text-[12px]">
          <span className="text-muted-foreground">{S.skills.typeName}</span>
          <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Competitor" className="h-9 rounded-lg border px-3 text-sm outline-none focus:border-foreground/30" data-type-label />
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          {COLOR_TOKENS.map((c) => (
            <button key={c} aria-label={c} onClick={() => setColor(c)} className={cn('size-6 rounded-full border border-black/5', color === c && 'ring-2 ring-foreground/70 ring-offset-2 ring-offset-background')} style={{ background: COLORS[c].light.bg }} />
          ))}
        </div>
        <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
          {SKILL_ICONS.map((n) => {
            const I = iconByName(n)
            return (
              <button key={n} aria-label={n} onClick={() => setIcon(n)} className={cn('flex size-7 items-center justify-center rounded-md hover:bg-accent', icon === n && 'bg-foreground text-background hover:bg-foreground')}>
                <I className="size-3.5" />
              </button>
            )
          })}
        </div>
        <div>
          <div className="text-[12px] font-semibold">{S.skills.fields}</div>
          <p className="text-[11px] text-muted-foreground">{S.skills.fieldsHint}</p>
          <div className="mt-2 flex flex-col gap-1.5">
            {fields.map((f, i) => (
              <div key={i} className="flex items-center gap-1.5" data-field-editor={f.key}>
                <input value={f.label} onChange={(e) => setField(i, { label: e.target.value, key: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || f.key })} className="h-8 flex-1 rounded-lg border px-2 text-[12px] outline-none" />
                <select value={f.kind} onChange={(e) => setField(i, { kind: e.target.value as FieldDef['kind'], ...(e.target.value === 'enum' ? { options: ['one', 'two'] } : {}) })} className="h-8 rounded-lg border bg-background px-1.5 text-[12px]">
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="boolean">Yes / no</option>
                  <option value="enum">Choice</option>
                </select>
                {f.kind === 'enum' && <input value={f.options.join(', ')} onChange={(e) => setField(i, { options: e.target.value.split(',').map((o) => o.trim().toLowerCase()).filter(Boolean) })} className="h-8 w-32 rounded-lg border px-2 text-[12px] outline-none" />}
                <button onClick={() => setFields(fields.filter((_, j) => j !== i))} className="flex size-8 items-center justify-center rounded-lg hover:bg-accent" aria-label="Remove field">
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            {fields.length < 8 && (
              <button onClick={() => setFields([...fields, { key: `field${fields.length + 1}`, label: `Field ${fields.length + 1}`, kind: 'text' }])} className="flex h-8 items-center gap-1 self-start rounded-lg px-2 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground">
                <Plus className="size-3.5" /> {S.skills.addField}
              </button>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setBlockId(null)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!label.trim() || busy} data-save-type-submit>
            {S.skills.save}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
