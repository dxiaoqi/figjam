import { Globe, KeyRound, ShieldQuestion } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CAPABILITIES, type PermissionDecision, type PermissionRequest, type SecurityServerMessage } from '@aifig/shared'
import { apiFetch } from '../lib/auth'
import { SECURITY_EVENT } from '../sync/provider'

const SOURCE: Record<PermissionRequest['source']['kind'], string> = { tool: 'tool', skill: 'skill', assistant: 'assistant', snippet: 'snippet' }

/**
 * The one permission prompt: an agent, skill or the assistant asks to touch the network or a secret. Requests
 * queue up; unanswered ones expire on the core's side (the agent is told it wasn't approved).
 */
export function PermissionPrompt() {
  const [queue, setQueue] = useState<PermissionRequest[]>([])
  const [busy, setBusy] = useState(false)

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
      if (!body.ok) toast.info('That request already expired')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setQueue((q) => q.filter((x) => x.id !== req.id))
      setBusy(false)
    }
  }

  if (!req) return null
  const cap = CAPABILITIES[req.capability]
  const Icon = req.capability === 'network' ? Globe : KeyRound
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && answer('deny')}>
      <DialogContent className="sm:max-w-md" data-permission-prompt={req.id}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldQuestion className="size-4" /> {req.actor.name} is asking for {cap.label.toLowerCase()}
          </DialogTitle>
          <DialogDescription>{req.reason}.</DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-3 rounded-xl border bg-muted/40 p-3 text-sm">
          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div>
              Wants to {cap.verb} <span className="font-mono font-medium break-all">{req.target}</span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              via the {SOURCE[req.source.kind]} <span className="font-mono">{req.source.id}</span>
              {queue.length > 1 ? ` · ${queue.length - 1} more waiting` : ''}
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Every decision is recorded in Activity. You can remove remembered permissions there.</p>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => answer('deny')} disabled={busy} data-permission-deny>
            Deny
          </Button>
          <Button variant="outline" onClick={() => answer('allow-always')} disabled={busy} data-permission-always>
            Always allow {req.actor.name}
          </Button>
          <Button onClick={() => answer('allow-once')} disabled={busy} data-permission-once>
            Allow once
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
