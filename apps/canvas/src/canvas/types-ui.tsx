import { Check, CircleHelp, Filter, FlaskConical, Lightbulb, Quote, Sparkles, SquareCheck, X, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useCamera, useEditorVersion, type Editor } from '@aifig/canvas-engine'
import {
  BLOCK_TYPE_IDS,
  BLOCK_TYPES,
  COLORS,
  detectPrefix,
  matchesQuery,
  suggestRelation,
  typeFields,
  typePatch,
  type Block,
  type BlockTypeId,
  type FieldValue,
} from '@aifig/shared'
import { cn } from '@/lib/utils'
import { useBoard } from '../board-context'
import { useCommentPrefs } from './comment-prefs'
import { useEditor } from './editor-context'

export const TYPE_ICONS: Record<BlockTypeId, LucideIcon> = {
  insight: Sparkles,
  question: CircleHelp,
  quote: Quote,
  hypothesis: FlaskConical,
  idea: Lightbulb,
  todo: SquareCheck,
}

export const isTypeable = (b?: Block) => !!b && (b.kind === 'sticky' || b.kind === 'card')

// ---- small stores (per user, not in the board) --------------------------------------

function store<T>(key: string, initial: T) {
  let value: T = initial
  try {
    const raw = localStorage.getItem(key)
    if (raw != null) value = JSON.parse(raw)
  } catch {
    /* keep the default */
  }
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (v: T) => {
      value = v
      if (key) localStorage.setItem(key, JSON.stringify(v))
      listeners.forEach((l) => l())
    },
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

/** Leading-prefix auto typing ("? …" → Question). Can be turned off. */
export const autoType = store<boolean>('aifig:auto-type', true)
export const useAutoType = () => useSyncExternalStore(autoType.subscribe, autoType.get)

export interface TypeFilter {
  type: BlockTypeId | null
  where: Record<string, FieldValue>
}
export const typeFilter = store<TypeFilter>('', { type: null, where: {} })
export const useTypeFilter = () => useSyncExternalStore(typeFilter.subscribe, typeFilter.get)
export const filterActive = (f: TypeFilter) => !!f.type
export const matchesFilter = (b: Block, f: TypeFilter) => !f.type || matchesQuery(b, { type: f.type, where: f.where })

// ---- promote / demote (local, undoable) --------------------------------------------

export function setBlocksType(editor: Editor, ids: string[], type: BlockTypeId | null, fields?: Record<string, FieldValue>) {
  const updates = ids
    .map((id) => editor.block(id))
    .filter(isTypeable)
    .map((b) => ({ id: b!.id, patch: typePatch(b!, type, fields) }))
    .filter((u) => Object.keys(u.patch).length)
  if (updates.length) editor.updateBlocks(updates)
}

export function setField(editor: Editor, b: Block, key: string, value: FieldValue) {
  if (!b.type) return
  editor.updateBlock(b.id, typePatch(b, undefined, { [key]: value }))
}

/** Promote a sticky typed with a known prefix once editing ends ("? why churn" → Question "why churn"). */
export function applyPrefix(editor: Editor, id: string) {
  if (!autoType.get()) return
  const b = editor.block(id)
  if (!b || b.type || b.kind !== 'sticky') return
  const hit = detectPrefix(b.text)
  if (!hit) return
  editor.updateBlock(id, { ...typePatch(b, hit.type), text: hit.text })
}

// ---- rendering inside blocks ------------------------------------------------------

export function TypeHeader({ block }: { block: Block }) {
  if (!block.type) return null
  const def = BLOCK_TYPES[block.type]
  const Icon = TYPE_ICONS[block.type]
  return (
    <div className="aifig-type-header" data-type-header={block.type}>
      <Icon className="size-3.5" strokeWidth={2.25} />
      {def.label}
    </div>
  )
}

const STATUS_DOT: Record<string, string> = { unverified: 'bg-stone-400', supported: 'bg-emerald-500', refuted: 'bg-red-500' }

/** Collapsed fields: a one-line summary; click to edit (todo's checkbox toggles directly). */
export function TypeFooter({ block, editor }: { block: Block; editor: Editor }) {
  if (!block.type || !BLOCK_TYPES[block.type].fields.length) return null
  const f = typeFields(block)
  const open = (e: React.MouseEvent) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent('aifig:edit-fields', { detail: block.id }))
  }
  const stop = (e: React.PointerEvent) => e.stopPropagation()
  let body: React.ReactNode
  if (block.type === 'todo') {
    body = (
      <>
        <button
          data-ui
          data-todo-toggle
          onPointerDown={stop}
          onClick={(e) => {
            e.stopPropagation()
            setField(editor, block, 'done', !f.done)
          }}
          className={cn('flex size-4 items-center justify-center rounded-[4px] border border-current/40', f.done && 'border-transparent bg-current/80')}
          aria-label={f.done ? 'Mark not done' : 'Mark done'}
        >
          {f.done && <Check className="size-3 text-[var(--fade-bg)]" strokeWidth={3} />}
        </button>
        <button data-ui onPointerDown={stop} onClick={open} className={cn('truncate', !f.owner && 'opacity-50')}>
          {f.owner ? `@${f.owner}` : 'Add owner'}
        </button>
      </>
    )
  } else if (block.type === 'hypothesis') {
    body = (
      <button data-ui onPointerDown={stop} onClick={open} className="flex items-center gap-1.5 truncate">
        <span className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[String(f.status)] ?? 'bg-stone-400')} />
        <span className="capitalize">{String(f.status)}</span>
        <span className="opacity-60">· {String(f.confidence)}</span>
      </button>
    )
  } else {
    const parts = [f.interviewee, f.source].filter(Boolean)
    body = (
      <button data-ui onPointerDown={stop} onClick={open} className={cn('truncate', !parts.length && 'opacity-50')}>
        {parts.length ? `— ${parts.join(', ')}` : 'Add who & source'}
      </button>
    )
  }
  return (
    <div className="aifig-type-footer" data-type-footer>
      {body}
    </div>
  )
}

// ---- filter bar ---------------------------------------------------------------------

export function TypeFilterBar() {
  const editor = useEditor()
  useEditorVersion(editor)
  const f = useTypeFilter()
  const { mode: commentMode } = useCommentPrefs()
  const docVersion = editor.getDocVersion()
  const blocks = useMemo(() => editor.blocks().filter(isTypeable), [editor, docVersion])
  const counts = useMemo(() => Object.fromEntries(BLOCK_TYPE_IDS.map((t) => [t, blocks.filter((b) => b.type === t).length])), [blocks])
  const present = BLOCK_TYPE_IDS.filter((t) => counts[t])
  if ((!present.length && !f.type) || commentMode) return null
  const def = f.type ? BLOCK_TYPES[f.type] : null
  const facetFields = def?.fields.filter((x) => x.kind !== 'text') ?? []
  const matching = f.type ? blocks.filter((b) => matchesFilter(b, f)) : []
  return (
    <div className="pointer-events-auto absolute top-3 left-1/2 z-[300] flex max-w-[calc(100vw-420px)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 max-md:top-16 max-md:max-w-[calc(100vw-24px)]" data-type-filter>
      <div className="chrome flex items-center gap-0.5 rounded-xl p-1">
        <span className="flex items-center gap-1 px-1.5 text-[11px] text-muted-foreground">
          <Filter className="size-3" />
        </span>
        {present.map((t) => {
          const Icon = TYPE_ICONS[t]
          const on = f.type === t
          return (
            <button
              key={t}
              data-filter-type={t}
              onClick={() => typeFilter.set(on ? { type: null, where: {} } : { type: t, where: {} })}
              className={cn('flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium transition-colors', on ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
            >
              <Icon className="size-3.5" style={on ? undefined : { color: COLORS[BLOCK_TYPES[t].color].light.accent }} />
              {BLOCK_TYPES[t].plural}
              <span className="tabular-nums opacity-60">{counts[t]}</span>
            </button>
          )
        })}
      </div>
      {def && facetFields.length > 0 && (
        <div className="chrome flex items-center gap-0.5 rounded-xl p-1 animate-in fade-in slide-in-from-left-1 duration-150">
          {facetFields.flatMap((fd) =>
            (fd.kind === 'enum' ? fd.options : ['true', 'false']).map((opt) => {
              const val: FieldValue = fd.kind === 'boolean' ? opt === 'true' : opt
              const on = f.where[fd.key] === val
              const n = blocks.filter((b) => b.type === f.type && typeFields(b)[fd.key] === val).length
              const label = fd.kind === 'boolean' ? (val ? fd.label : `Not ${fd.label.toLowerCase()}`) : opt
              return (
                <button
                  key={`${fd.key}:${opt}`}
                  data-filter-field={`${fd.key}=${opt}`}
                  disabled={!n && !on}
                  onClick={() => {
                    const where = { ...f.where }
                    if (on) delete where[fd.key]
                    else where[fd.key] = val
                    typeFilter.set({ ...f, where })
                  }}
                  className={cn('h-7 rounded-lg px-2 text-[12px] capitalize transition-colors disabled:opacity-35', on ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
                >
                  {label} <span className="tabular-nums opacity-60">{n}</span>
                </button>
              )
            }),
          )}
        </div>
      )}
      {def && (
        <div className="chrome flex items-center gap-1 rounded-xl py-1 pr-1 pl-2.5 text-[12px] text-muted-foreground">
          <span data-filter-count>
            {matching.length} of {blocks.length}
          </span>
          <button onClick={() => editor.select(matching.map((b) => b.id))} className="h-7 rounded-lg px-2 font-medium text-foreground hover:bg-accent">
            Select
          </button>
          <button onClick={() => typeFilter.set({ type: null, where: {} })} className="flex size-7 items-center justify-center rounded-lg hover:bg-accent" aria-label="Clear filter">
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

// ---- overlays: field editor and the type palette ----------------------------------------

function anchorBelow(editor: Editor, id: string, width: number) {
  const r = editor.visualRect(id)
  if (!r) return null
  const p = editor.pageToScreen({ x: r.x, y: r.y + r.h })
  return { left: Math.min(Math.max(12, p.x), editor.viewport.w - width - 12), top: Math.min(p.y + 8, editor.viewport.h - 220) }
}

function useOutside(ref: React.RefObject<HTMLElement | null>, onClose: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose()
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [ref, onClose, active])
}

/** Field editor for one typed block (fields stay collapsed on the block itself). */
export function FieldsPopover() {
  const editor = useEditor()
  useEditorVersion(editor)
  useCamera(editor)
  const [id, setId] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const on = (e: Event) => setId((e as CustomEvent<string>).detail)
    window.addEventListener('aifig:edit-fields', on)
    return () => window.removeEventListener('aifig:edit-fields', on)
  }, [])
  const close = useMemo(() => () => setId(null), [])
  useOutside(ref, close, !!id)
  const b = id ? editor.block(id) : undefined
  if (!b?.type) return null
  const def = BLOCK_TYPES[b.type]
  const at = anchorBelow(editor, b.id, 260)
  if (!at) return null
  const f = typeFields(b)
  return (
    <div ref={ref} data-ui data-fields-popover className="chrome pointer-events-auto absolute z-[320] w-[260px] rounded-xl p-3 text-[12px] animate-in fade-in zoom-in-95 duration-150" style={at}>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {(() => {
          const Icon = TYPE_ICONS[b.type!]
          return <Icon className="size-3.5" />
        })()}
        {def.label}
      </div>
      <div className="flex flex-col gap-2.5">
        {def.fields.map((fd) => (
          <label key={fd.key} className="flex flex-col gap-1">
            <span className="text-muted-foreground">{fd.label}</span>
            {fd.kind === 'enum' ? (
              <div className="flex gap-1">
                {fd.options.map((o) => (
                  <button
                    key={o}
                    data-field-option={`${fd.key}=${o}`}
                    onClick={() => setField(editor, b, fd.key, o)}
                    className={cn('h-7 flex-1 rounded-md px-1.5 capitalize transition-colors', f[fd.key] === o ? 'bg-foreground text-background' : 'bg-muted/70 hover:bg-accent')}
                  >
                    {o}
                  </button>
                ))}
              </div>
            ) : fd.kind === 'boolean' ? (
              <button onClick={() => setField(editor, b, fd.key, !f[fd.key])} className={cn('h-7 rounded-md px-2 text-left', f[fd.key] ? 'bg-foreground text-background' : 'bg-muted/70')}>
                {f[fd.key] ? 'Yes' : 'No'}
              </button>
            ) : (
              <input
                data-field-input={fd.key}
                defaultValue={String(f[fd.key] ?? '')}
                placeholder={fd.placeholder}
                maxLength={120}
                onChange={(e) => setField(editor, b, fd.key, e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') close()
                }}
                className="h-7 rounded-md bg-muted/70 px-2 outline-none placeholder:text-muted-foreground/60"
              />
            )}
          </label>
        ))}
      </div>
    </div>
  )
}

interface PaletteState {
  ids: string[]
  query: string
  slash: boolean
}

/** "Set as…" palette: `/` on a selection, or `/` at the start of an empty sticky while writing. */
export function TypePalette() {
  const editor = useEditor()
  useEditorVersion(editor)
  useCamera(editor)
  const [st, setSt] = useState<PaletteState | null>(null)
  const [index, setIndex] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const close = useMemo(() => () => setSt(null), [])
  useOutside(ref, close, !!st)

  const options: { id: BlockTypeId | null; label: string }[] = useMemo(() => {
    const all = [...BLOCK_TYPE_IDS.map((t) => ({ id: t as BlockTypeId | null, label: BLOCK_TYPES[t].label })), { id: null, label: 'Plain (no type)' }]
    const q = st?.query.toLowerCase() ?? ''
    return all.filter((o) => !q || o.label.toLowerCase().startsWith(q) || (o.id ?? 'plain').startsWith(q))
  }, [st?.query])

  const choose = (o: { id: BlockTypeId | null }) => {
    if (!st) return
    if (st.slash) {
      const b = editor.block(st.ids[0])
      if (b) {
        document.querySelector(`[data-block-id="${b.id}"] .aifig-rich-host`)?.dispatchEvent(new Event('aifig-clear'))
        editor.updateBlock(b.id, { ...typePatch(b, o.id), text: '' })
      }
    } else setBlocksType(editor, st.ids, o.id)
    setSt(null)
  }

  useEffect(() => {
    const open = (e: Event) => {
      setSt((e as CustomEvent<PaletteState>).detail)
      setIndex(0)
    }
    const closeEv = () => setSt(null)
    window.addEventListener('aifig:type-palette', open)
    window.addEventListener('aifig:type-palette-close', closeEv)
    return () => {
      window.removeEventListener('aifig:type-palette', open)
      window.removeEventListener('aifig:type-palette-close', closeEv)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'
      if (!st) {
        if (e.key !== '/' || typing || editor.editingId || e.metaKey || e.ctrlKey) return
        const ids = editor.selectedBlocks().filter(isTypeable).map((b) => b.id)
        if (!ids.length) return
        e.preventDefault()
        setSt({ ids, query: '', slash: false })
        setIndex(0)
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % Math.max(1, options.length))
      } else if (e.key === 'Enter' && options.length) {
        e.preventDefault()
        e.stopPropagation()
        choose(options[Math.min(index, options.length - 1)])
      } else if (!st.slash && e.key.length === 1 && /[a-z]/i.test(e.key) && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        e.stopPropagation()
        setSt({ ...st, query: st.query + e.key })
        setIndex(0)
      } else if (!st.slash && e.key === 'Backspace' && !typing) {
        e.preventDefault()
        e.stopPropagation()
        setSt({ ...st, query: st.query.slice(0, -1) })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  if (!st) return null
  const at = anchorBelow(editor, st.ids[0], 220)
  if (!at) return null
  return (
    <div ref={ref} data-ui data-type-palette className="chrome pointer-events-auto absolute z-[320] w-[220px] rounded-xl p-1 text-[13px] animate-in fade-in zoom-in-95 duration-150" style={at}>
      <div className="px-2 pt-1 pb-1.5 text-[11px] text-muted-foreground">
        Set as{st.query ? ` · “${st.query}”` : '…'}
      </div>
      {options.map((o, i) => {
        const Icon = o.id ? TYPE_ICONS[o.id] : null
        return (
          <button
            key={o.id ?? 'plain'}
            data-palette-option={o.id ?? 'plain'}
            onMouseEnter={() => setIndex(i)}
            onClick={() => choose(o)}
            className={cn('flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left', i === index && 'bg-accent')}
          >
            {Icon ? <Icon className="size-4" style={{ color: COLORS[BLOCK_TYPES[o.id!].color].light.accent }} /> : <span className="size-4" />}
            <span className="flex-1">{o.label}</span>
            {o.id && BLOCK_TYPES[o.id].prefixes[0] && <kbd className="font-mono text-[10px] text-muted-foreground">{BLOCK_TYPES[o.id].prefixes[0]}</kbd>}
          </button>
        )
      })}
      {!options.length && <div className="px-2 py-2 text-xs text-muted-foreground">No type matches</div>}
    </div>
  )
}

/** Connectors people draw between typed blocks get the suggested relation (quote → insight: supports). */
export function useRelationSuggestions(editor: Editor | null) {
  const { provider } = useBoard()
  useEffect(() => {
    if (!editor) return
    const map = editor.connectorsMap
    const on = (e: { changes: { keys: Map<string, { action: string }> } }, tr: { origin: unknown }) => {
      if (tr.origin !== editor.origin) return
      e.changes.keys.forEach((ch, id) => {
        if (ch.action !== 'add') return
        const c = map.get(id)
        if (!c || c.relation || !c.from || !c.to) return
        const rel = suggestRelation(editor.block(c.from)?.type, editor.block(c.to)?.type)
        if (rel) queueMicrotask(() => editor.doc.transact(() => map.set(id, { ...map.get(id)!, relation: rel }), editor.origin))
      })
    }
    map.observe(on as never)
    return () => map.unobserve(on as never)
  }, [editor, provider])
}
