import { Globe, KeyRound, Puzzle, ShieldCheck, ShieldX, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ActivityCategory, ActivityEntry, PermissionGrant, SecurityServerMessage } from '@aifig/shared'
import { cn } from '@/lib/utils'
import { apiFetch } from '../lib/auth'
import { SECURITY_EVENT } from '../sync/provider'

const ICON: Record<ActivityCategory, typeof Globe> = { network: Globe, secret: KeyRound, permission: ShieldCheck, auth: ShieldX, skill: Puzzle }
const FILTERS: { id: ActivityCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'network', label: 'Network' },
  { id: 'secret', label: 'Secrets' },
  { id: 'permission', label: 'Permissions' },
  { id: 'skill', label: 'Skills' },
  { id: 'auth', label: 'Blocked' },
]

const time = (at: number) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** Activity log (network, secrets, permissions, rejected clients) and remembered permissions. Opened with `aifig:activity`. */
export function ActivityDialog() {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null)
  const [grants, setGrants] = useState<PermissionGrant[]>([])
  const [filter, setFilter] = useState<ActivityCategory | 'all'>('all')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [a, p] = await Promise.all([apiFetch('/api/activity?limit=300').then((r) => r.json()), apiFetch('/api/permissions').then((r) => r.json())])
      setEntries(a.entries)
      setGrants(p.grants)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    const show = () => {
      setOpen(true)
      load()
    }
    window.addEventListener('aifig:activity', show)
    return () => window.removeEventListener('aifig:activity', show)
  }, [load])

  useEffect(() => {
    if (!open) return
    const on = (e: Event) => {
      const msg = (e as CustomEvent<SecurityServerMessage>).detail
      if (msg.type === 'activity') setEntries((cur) => (cur ? [msg.entry, ...cur].slice(0, 300) : cur))
    }
    window.addEventListener(SECURITY_EVENT, on)
    return () => window.removeEventListener(SECURITY_EVENT, on)
  }, [open])

  const revoke = async (g: PermissionGrant) => {
    const r = await apiFetch('/api/permissions/revoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(g) }).then((r) => r.json())
    if (r.ok) {
      setGrants(r.grants)
      toast.success('Permission removed')
    } else toast.error(r.error)
  }

  const shown = (entries ?? []).filter((e) => filter === 'all' || e.category === filter)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl" data-activity-dialog>
        <DialogHeader>
          <DialogTitle>Activity & permissions</DialogTitle>
          <DialogDescription>Everything agents, skills and the assistant did with the network or secrets, and every client the core turned away.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="activity">
          <TabsList>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="grants">Remembered permissions{grants.length ? ` (${grants.length})` : ''}</TabsTrigger>
          </TabsList>
          <TabsContent value="activity" className="space-y-2 pt-2">
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <Button key={f.id} size="sm" variant={filter === f.id ? 'secondary' : 'ghost'} className="h-7 px-2.5 text-xs" onClick={() => setFilter(f.id)}>
                  {f.label}
                </Button>
              ))}
            </div>
            <div className="max-h-[50vh] overflow-auto rounded-lg border">
              {error ? (
                <p className="p-4 text-sm text-destructive">Couldn’t load the activity log: {error}</p>
              ) : entries === null ? (
                <p className="p-4 text-sm text-muted-foreground">Loading…</p>
              ) : !shown.length ? (
                <p className="p-4 text-sm text-muted-foreground">Nothing here yet. When an agent fetches something or a key is used, it shows up here.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {shown.map((e) => {
                    const Icon = ICON[e.category]
                    return (
                      <li key={e.id} className="flex items-start gap-2.5 px-3 py-2" data-activity-entry={e.category}>
                        <Icon className={cn('mt-0.5 size-4 shrink-0', e.outcome === 'denied' || e.outcome === 'error' ? 'text-destructive' : 'text-muted-foreground')} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate">
                            <span className="font-medium">{e.actor.name}</span> {e.action.replace(/-/g, ' ')} {e.target && <span className="font-mono text-[12px]">{e.target}</span>}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {e.outcome}
                            {e.via ? ` · ${e.via}` : ''}
                            {e.detail ? ` · ${e.detail}` : ''}
                          </div>
                        </div>
                        <time className="shrink-0 text-xs text-muted-foreground tabular-nums">{time(e.at)}</time>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </TabsContent>
          <TabsContent value="grants" className="pt-2">
            {!grants.length ? (
              <p className="rounded-lg border p-4 text-sm text-muted-foreground">No remembered permissions. Agents ask in the canvas before they touch the network or secrets.</p>
            ) : (
              <ul className="divide-y rounded-lg border text-sm">
                {grants.map((g) => (
                  <li key={`${g.subject}|${g.capability}|${g.target}`} className="flex items-center gap-3 px-3 py-2">
                    <span className="font-mono text-[12px]">{g.subject}</span>
                    <span className="text-muted-foreground">{g.capability}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{g.target}</span>
                    <Button size="icon" variant="ghost" className="size-7" aria-label={`Remove ${g.subject} ${g.capability} ${g.target}`} onClick={() => revoke(g)}>
                      <X className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
