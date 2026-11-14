import { ChevronDown, FolderInput, Puzzle, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { COLORS, type ActivityEntry, type PermissionGrant } from '@nodboard/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useBoard } from '../board-context'
import { renderMarkdown } from '../canvas/markdown'
import { iconByName, useBoardSkills } from '../canvas/type-registry'
import { apiFetch } from '../lib/auth'
import { callCore } from '../lib/core'
import { getLocale, t, useT } from '../i18n'

interface SkillRow {
  name: string
  description: string
  version: string
  capability: 'L0' | 'L1'
  tools: { name: string; available: boolean; allowed: boolean }[]
  source: 'builtin' | 'user' | 'dev' | 'board'
  enabled: boolean
  enabledVersion?: string
  types: { id: string; label: string; base?: string; fields: string[] }[]
  layouts: string[]
  actions: { id: string; label: string; tool: string }[]
  errors?: string[]
  warnings?: string[]
}

interface SkillDetail {
  instructions: string
  types: { id: string; label: string; color: keyof typeof COLORS; icon: string; description: string; fields: { key: string; label: string; kind: string }[] }[]
  layouts: { id: string; label: string; intent: string; description?: string }[]
}

function CapabilityBadge({ c }: { c: 'L0' | 'L1' }) {
  useT()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold', c === 'L1' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300')}>
          {c} · {t(`skills.capability.${c}`)}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{t(`skills.capabilityNote.${c}`)}</TooltipContent>
    </Tooltip>
  )
}

function SkillCard({ s, onChange }: { s: SkillRow; onChange: () => void }) {
  const { boardId } = useBoard()
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [busy, setBusy] = useState(false)
  useT()
  useEffect(() => {
    if (open && !detail) callCore<SkillDetail>('get_skill', { name: s.name }).then(setDetail, () => {})
  }, [open, detail, s.name])
  const toggle = async () => {
    setBusy(true)
    try {
      const r = await callCore<{ warnings?: string[] }>(s.enabled ? 'disable_skill' : 'enable_skill', { board: boardId, name: s.name })
      r.warnings?.forEach((w) => toast.warning(w))
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const apply = async (layout: string) => {
    try {
      await callCore('apply_skill_layout', { board: boardId, layout })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  return (
    <div className={cn('rounded-xl border p-3', s.enabled && 'border-foreground/15 bg-accent/30')} data-skill-card={s.name}>
      <div className="flex items-start gap-2">
        <Puzzle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] font-semibold">{s.name}</span>
            <span className="text-[11px] text-muted-foreground">
              {s.version} · {s.source}
            </span>
            <CapabilityBadge c={s.capability} />
          </div>
          <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-muted-foreground">{s.description}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {s.types.map((ty) => (
              <span key={ty.id} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px]" title={ty.fields.join(', ')}>
                {ty.label}
              </span>
            ))}
          </div>
          {s.tools.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
              <ShieldCheck className="size-3" />
              {s.tools.map((tool) => (
                <span key={tool.name} className={cn('font-mono', !tool.available && 'line-through opacity-60')}>
                  {tool.name}
                  {!tool.available ? ` (${t('skills.toolNotConfigured')})` : tool.allowed ? ` (${t('skills.toolAllowed')})` : ''}
                </span>
              ))}
            </div>
          )}
          {s.errors?.length ? (
            <div className="mt-2 rounded-lg bg-red-500/10 p-2 text-[11px] text-red-700 dark:text-red-300" data-skill-errors>
              <div className="flex items-center gap-1 font-semibold">
                <TriangleAlert className="size-3" /> {t('skills.problems', { count: s.errors.length })}
              </div>
              <ul className="mt-1 list-disc pl-4">
                {s.errors.slice(0, 6).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <Button size="sm" variant={s.enabled ? 'outline' : 'default'} className="h-7 shrink-0 text-xs" disabled={busy || !!s.errors?.length} onClick={toggle} data-skill-toggle={s.name}>
          {s.enabled ? t('skills.disable') : t('skills.enable')}
        </Button>
      </div>
      <button className="mt-2 flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground" onClick={() => setOpen(!open)}>
        <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} /> {t('skills.instructions')}
      </button>
      {open && detail && (
        <div className="mt-2 space-y-3 text-[12px]">
          <div className="nodboard-rich max-h-48 overflow-y-auto rounded-lg bg-muted/50 p-2.5 leading-relaxed" data-skill-instructions>
            {renderMarkdown(detail.instructions.replace(/^#+\s*/gm, '**').replace(/^(\*\*[^\n]*)$/gm, '$1**'))}
          </div>
          <div>
            <div className="mb-1 font-semibold">{t('skills.types')}</div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {detail.types.map((ty) => {
                const Icon = iconByName(ty.icon)
                return (
                  <div key={ty.id} className="flex items-start gap-2 rounded-lg border p-2">
                    <Icon className="mt-0.5 size-3.5 shrink-0" style={{ color: COLORS[ty.color]?.light.accent }} />
                    <div className="min-w-0">
                      <div className="font-medium">
                        {ty.label} <code className="text-[10px] text-muted-foreground">{ty.id}</code>
                      </div>
                      <div className="text-[11px] text-muted-foreground">{ty.fields.map((f) => `${f.label} (${f.kind})`).join(' · ') || '—'}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          {detail.layouts.length > 0 && (
            <div>
              <div className="mb-1 font-semibold">{t('skills.layouts')}</div>
              <div className="flex flex-col gap-1">
                {detail.layouts.map((l) => (
                  <div key={l.id} className="flex items-center gap-2 rounded-lg border px-2 py-1.5">
                    <span className="flex-1">
                      {l.label} <span className="text-[11px] text-muted-foreground">· {l.intent}</span>
                    </span>
                    <Button size="sm" variant="ghost" className="h-6 text-[11px]" disabled={!s.enabled} onClick={() => apply(l.id)} data-apply-layout={l.id}>
                      {t('skills.applyLayout')}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ActivityList() {
  const { boardId } = useBoard()
  const [data, setData] = useState<{ activity: ActivityEntry[]; grants: PermissionGrant[] } | null>(null)
  useT()
  const load = useCallback(() => callCore<{ activity: ActivityEntry[]; grants: PermissionGrant[] }>('list_activity', { board: boardId, limit: 100 }).then(setData, () => {}), [boardId])
  useEffect(() => {
    load()
    const timer = setInterval(load, 2000)
    return () => clearInterval(timer)
  }, [load])
  const revoke = async (g: PermissionGrant) => {
    await apiFetch('/api/permissions/revoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject: g.subject, capability: g.capability, target: g.target }) })
    load()
  }
  if (!data) return null
  return (
    <div className="flex flex-col gap-3 text-[12px]" data-skill-activity>
      {data.grants.length > 0 && (
        <div>
          <div className="mb-1 font-semibold">{t('skills.allowed')}</div>
          {data.grants.map((g) => (
            <div key={`${g.subject}:${g.target}`} className="flex items-center gap-2 rounded-lg border px-2 py-1.5">
              <span className="flex-1">
                {g.subject.replace(/^skill:/, '')} → <code className="font-mono">{g.target}</code>
              </span>
              <Button size="sm" variant="ghost" className="h-6 text-[11px]" data-revoke={`${g.subject.replace(/^skill:/, '')}:${g.target}`} onClick={() => revoke(g)}>
                {t('skills.revoke')}
              </Button>
            </div>
          ))}
        </div>
      )}
      {!data.activity.length ? (
        <p className="text-muted-foreground">{t('skills.noActivity')}</p>
      ) : (
        <div className="max-h-80 overflow-y-auto rounded-lg border">
          {data.activity.map((e) => (
            <div key={e.id} className="flex gap-2 border-b px-2.5 py-1.5 last:border-0" data-activity-entry={e.category === 'permission' ? 'permission' : e.action}>
              <span className={cn('mt-1 size-1.5 shrink-0 rounded-full', e.outcome === 'ok' || e.outcome === 'allowed' ? 'bg-emerald-500' : 'bg-red-500')} />
              <div className="min-w-0 flex-1">
                <div>
                  <span className="font-medium">{e.source?.id}</span> · {e.category === 'permission' ? t('skills.permissionEvent') : e.action}
                  {e.target ? (
                    <>
                      {' '}
                      · <code className="font-mono">{e.target}</code>
                    </>
                  ) : null}{' '}
                  · <span className="text-muted-foreground">{t(`activity.outcome.${e.outcome}`)}{e.via ? ` (${e.via})` : ''}</span>
                </div>
                {(e.detail || e.actor) && <div className="truncate text-[11px] text-muted-foreground">{[e.actor?.name, e.detail].filter(Boolean).join(' · ')}</div>}
              </div>
              <span className="shrink-0 text-[11px] text-muted-foreground">{new Date(e.at).toLocaleTimeString(getLocale())}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function SkillsButton() {
  const enabled = useBoardSkills()
  useT()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 rounded-lg px-2 text-[13px]" onClick={() => window.dispatchEvent(new Event('nodboard:skills'))} aria-label={t('skills.panelTitle')} data-skills-button>
          <Puzzle className="size-4" strokeWidth={1.75} />
          {enabled.length > 0 && <span className="text-[11px] tabular-nums text-muted-foreground">{enabled.length}</span>}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{t('skills.panelTitle')}</TooltipContent>
    </Tooltip>
  )
}

export function SkillsPanel() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('board')
  const [rows, setRows] = useState<SkillRow[]>([])
  const [path, setPath] = useState('')
  const { boardId } = useBoard()
  const onBoard = useBoardSkills()
  useT()
  const load = useCallback(() => callCore<{ skills: SkillRow[] }>('list_skills', { board: boardId }).then((r) => setRows(r.skills), (e) => toast.error((e as Error).message)), [boardId])
  useEffect(() => {
    const on = (e: Event) => {
      setTab((e as CustomEvent<string | undefined>).detail ?? 'board')
      setOpen(true)
    }
    window.addEventListener('nodboard:skills', on)
    return () => window.removeEventListener('nodboard:skills', on)
  }, [])
  useEffect(() => {
    if (open) load()
  }, [open, load, onBoard])
  const install = async () => {
    try {
      const r = await callCore<{ installed: string; warnings: string[] }>('install_skill', { path: path.trim() })
      toast.success(t('skills.installed', { name: r.installed }))
      r.warnings?.forEach((w) => toast.warning(w))
      setPath('')
      load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const enabled = rows.filter((r) => r.enabled)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl" data-skills-panel>
        <DialogHeader>
          <DialogTitle>{t('skills.panelTitle')}</DialogTitle>
          <DialogDescription>{t('skills.panelDescription')}</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="board">
              {t('skills.onBoard')} {enabled.length ? `(${enabled.length})` : ''}
            </TabsTrigger>
            <TabsTrigger value="library">{t('skills.library')}</TabsTrigger>
            <TabsTrigger value="activity">{t('skills.activity')}</TabsTrigger>
          </TabsList>
          <TabsContent value="board" className="flex flex-col gap-2 pt-2">
            {enabled.length ? enabled.map((s) => <SkillCard key={s.name} s={s} onChange={load} />) : <p className="py-6 text-center text-[13px] text-muted-foreground">{t('skills.noneEnabled')}</p>}
          </TabsContent>
          <TabsContent value="library" className="flex flex-col gap-2 pt-2">
            {rows.map((s) => (
              <SkillCard key={s.name} s={s} onChange={load} />
            ))}
            <div className="mt-2 rounded-xl border border-dashed p-3">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold">
                <FolderInput className="size-3.5" /> {t('skills.installTitle')}
              </div>
              <div className="mt-2 flex gap-2">
                <input value={path} onChange={(e) => setPath(e.target.value)} placeholder={t('skills.pathPlaceholder')} className="h-8 flex-1 rounded-lg border bg-muted/40 px-2.5 font-mono text-[12px] outline-none" data-install-path />
                <Button size="sm" className="h-8" disabled={!path.trim()} onClick={install}>
                  {t('skills.install')}
                </Button>
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">{t('skills.installHint')}</p>
            </div>
          </TabsContent>
          <TabsContent value="activity" className="pt-2">
            {open && tab === 'activity' && <ActivityList />}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
