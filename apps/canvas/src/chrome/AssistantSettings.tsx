import { KeyRound, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { desktop } from '../lib/desktop'
import { t, tn, useT } from '../i18n'

const PROVIDERS = [
  { id: null, label: 'assistant.off', hint: 'assistant.offHint' },
  { id: 'anthropic', label: 'assistant.anthropic', hint: 'assistant.anthropicHint' },
  { id: 'openai', label: 'assistant.openai', hint: 'assistant.openaiHint' },
  { id: 'mock', label: 'assistant.mock', hint: 'assistant.mockHint' },
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
  useT()

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
      toast.success(t(provider ? 'assistant.on' : 'assistant.turnedOff'))
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
            <Sparkles className="size-4" /> {t('assistant.title')}
          </DialogTitle>
          <DialogDescription>{t('assistant.description')}</DialogDescription>
        </DialogHeader>
        {!desktop ? (
          <p className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
            {tn('assistant.browserOnly', { env: <code className="font-mono">AIFIG_ASSISTANT=mock</code> })}
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
                  <div className="text-sm font-medium">{t(p.label)}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{t(p.hint)}</div>
                </button>
              ))}
            </div>
            {needsKey && (
              <div className="space-y-2">
                <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={t(hasKey ? 'assistant.keySaved' : 'assistant.apiKey')} autoComplete="off" />
                <div className="grid grid-cols-2 gap-2">
                  <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={t('assistant.model', { example: provider === 'anthropic' ? 'claude-3-5-haiku-latest' : 'gpt-4o-mini' })} />
                  {provider === 'openai' && <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={t('assistant.baseUrl')} />}
                </div>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <KeyRound className="size-3.5" />
                  {encryption === 'unavailable'
                    ? t('assistant.noKeychain')
                    : t('assistant.keychain')}
                </p>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          {desktop && (
            <Button onClick={save} disabled={saving || (needsKey && !key && !hasKey)}>
              {t('common.save')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
