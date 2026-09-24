import { KeyRound, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { desktop } from '../lib/desktop'

const PROVIDERS = [
  { id: null, label: 'Off', hint: 'Everything works without a model — use your own agents over MCP.' },
  { id: 'anthropic', label: 'Anthropic', hint: 'Claude models with your own API key.' },
  { id: 'openai', label: 'OpenAI-compatible', hint: 'OpenAI, OpenRouter, Ollama, LM Studio… any /chat/completions endpoint.' },
  { id: 'mock', label: 'Demo (offline)', hint: 'A deterministic stand-in, handy for trying the commands and for tests.' },
] as const

/** Optional built-in assistant: provider + key, stored in the OS keychain by the desktop app. */
export function AssistantSettings() {
  const [open, setOpen] = useState(false)
  const [provider, setProvider] = useState<string | null>(null)
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [key, setKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [encryption, setEncryption] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const show = async () => {
      if (desktop) {
        const s = await desktop.assistant.get()
        setProvider(s.provider)
        setModel(s.model)
        setBaseUrl(s.baseUrl)
        setHasKey(s.hasKey)
        setEncryption(s.encryption)
      }
      setKey('')
      setOpen(true)
    }
    window.addEventListener('aifig:assistant-settings', show)
    return () => window.removeEventListener('aifig:assistant-settings', show)
  }, [])

  const save = async () => {
    if (!desktop) return
    setSaving(true)
    try {
      await desktop.assistant.save({ provider, model, baseUrl, key: key || undefined })
      window.dispatchEvent(new Event('aifig:assistant-changed'))
      toast.success(provider ? 'Assistant is on — find it on the right-click menu' : 'Assistant turned off')
      setOpen(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const needsKey = provider === 'anthropic' || provider === 'openai'
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" /> Built-in assistant
          </DialogTitle>
          <DialogDescription>Optional selection commands — extract ideas, cluster into themes, tidy. Its edits arrive as change sets you review, like any agent.</DialogDescription>
        </DialogHeader>
        {!desktop ? (
          <p className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
            API keys are kept in the OS keychain, so the assistant is configured in the desktop app. For local development you can start the core with{' '}
            <code className="font-mono">AIFIG_ASSISTANT=mock</code>.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => setProvider(p.id)}
                  className={cn('rounded-xl border p-3 text-left transition-colors hover:bg-accent/50', provider === p.id && 'border-primary ring-1 ring-primary')}
                >
                  <div className="text-sm font-medium">{p.label}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{p.hint}</div>
                </button>
              ))}
            </div>
            {needsKey && (
              <div className="space-y-2">
                <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={hasKey ? 'Key saved — paste a new one to replace it' : 'API key'} autoComplete="off" />
                <div className="grid grid-cols-2 gap-2">
                  <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={provider === 'anthropic' ? 'Model (claude-3-5-haiku-latest)' : 'Model (gpt-4o-mini)'} />
                  {provider === 'openai' && <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="Base URL (optional)" />}
                </div>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <KeyRound className="size-3.5" />
                  {encryption === 'unavailable'
                    ? 'This system has no keychain available, so keys can’t be saved securely here.'
                    : 'Stored encrypted in your OS keychain. Never written to board files.'}
                </p>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          {desktop && (
            <Button onClick={save} disabled={saving || (needsKey && !key && !hasKey)}>
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
