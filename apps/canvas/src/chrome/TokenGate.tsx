import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isValidToken, setToken } from '../lib/auth'
import { Logo } from './BoardMenu'
import { t, tn, useT } from '../i18n'

/** Shown when the core rejects this browser: it needs the local access token once. */
export function TokenGate({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  useT()
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValidToken(value)) return setError(t('auth.invalid'))
    setToken(value)
    setError('')
    onDone()
  }
  return (
    <div className="flex h-full items-center justify-center bg-background p-6" data-token-gate>
      <div className="w-[460px] max-w-full rounded-3xl border bg-card p-8 shadow-sm">
        <Logo className="mb-5 size-9" />
        <h1 className="text-lg font-semibold tracking-tight">{t('auth.title')}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('auth.body')}</p>
        <pre className="mt-4 rounded-lg border bg-muted/60 p-3 font-mono text-[12px]">npx aifig open{location.port === '47820' ? ' --dev' : ''}</pre>
        <p className="mt-3 text-sm text-muted-foreground">{tn('auth.orPaste', { cmd: <code className="font-mono">npx aifig token</code> })}</p>
        <form onSubmit={submit} className="mt-2 flex gap-2">
          <Input type="password" autoComplete="off" spellCheck={false} placeholder={t('auth.placeholder')} value={value} onChange={(e) => setValue(e.target.value)} aria-label={t('auth.placeholder')} />
          <Button type="submit" className="gap-1.5" disabled={!value.trim()}>
            <KeyRound className="size-3.5" /> {t('auth.connect')}
          </Button>
        </form>
        {error && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        <p className="mt-4 text-xs text-muted-foreground">{t('auth.footer')}</p>
      </div>
    </div>
  )
}
