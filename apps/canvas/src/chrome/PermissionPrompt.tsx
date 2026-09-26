import { Globe, KeyRound, ShieldQuestion, Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { type PermissionDecision, type PermissionRequest, type SecurityServerMessage } from '@aifig/shared'
import { apiFetch } from '../lib/auth'
import { SECURITY_EVENT } from '../sync/provider'
import { t, tn, useT, type MessageKey } from '../i18n'

/**
 * The one permission prompt: an agent, skill or the assistant asks to touch the network or a secret. Requests
 * queue up; unanswered ones expire on the core's side (the agent is told it wasn't approved).
 */
export function PermissionPrompt() {
  const [queue, setQueue] = useState<PermissionRequest[]>([])
  const [busy, setBusy] = useState(false)
  useT()

  useEffect(() => {
    apiFetch('/api/permissions')
      .then((r) => (r.ok ? r.json() : { pending: [] }))
      .then((r: { pending: PermissionRequest[] }) => setQueue((q) => [...q, ...r.pending.filter((p) => !q.some((x) => x.id === p.id))]))
      .catch(() => {})
    const on = (e: Event) => {
      const msg = (e as CustomEvent<SecurityServerMessage>).detail
      if (msg.type === 'permission') setQueue((q) => (q.some((x) => x.id === msg.request.id) ? q : [...q, msg.request]))
      else if (msg.type === 'permission-settled') setQueue((q) => q.filter((x) => x.id !== msg.id))
    }
    window.addEventListener(SECURITY_EVENT, on)
    return () => window.removeEventListener(SECURITY_EVENT, on)
  }, [])

  const req = queue[0]
  const answer = async (decision: PermissionDecision) => {
    if (!req) return
    setBusy(true)
    try {
      const r = await apiFetch('/api/permissions/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: req.id, decision }) })
      const body = await r.json()
      if (!body.ok) toast.info(t('perm.expired'))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setQueue((q) => q.filter((x) => x.id !== req.id))
      setBusy(false)
    }
  }

  if (!req) return null
  const Icon = req.capability === 'network' ? Globe : req.capability === 'tool' ? Wrench : KeyRound
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && answer('deny')}>
      <DialogContent className="sm:max-w-md" data-permission-prompt={req.id}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldQuestion className="size-4" /> {t('perm.title', { actor: req.actor.name, capability: t(`perm.cap.${req.capability}` as MessageKey) })}
          </DialogTitle>
          <DialogDescription>{req.reason}.</DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-3 rounded-xl border bg-muted/40 p-3 text-sm">
          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div>
              {tn(`perm.wants.${req.capability}` as MessageKey, { target: <span className="font-mono font-medium break-all">{req.target}</span> })}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {tn('perm.via', { source: t(`perm.source.${req.source.kind}` as MessageKey), id: <span className="font-mono">{req.source.id}</span> })}
              {queue.length > 1 ? ` · ${t('perm.more', { count: queue.length - 1 })}` : ''}
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t('perm.note')}</p>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => answer('deny')} disabled={busy} data-permission-deny>
            {t('perm.deny')}
          </Button>
          <Button variant="outline" onClick={() => answer('allow-always')} disabled={busy} data-permission-always>
            {t('perm.always', { actor: req.actor.name })}
          </Button>
          <Button onClick={() => answer('allow-once')} disabled={busy} data-permission-once>
            {t('perm.once')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
