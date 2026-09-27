'use client'

import { Info, Mail } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { site } from '@/config/site'
import type { Dict } from '@/i18n'

/** Placeholder signup: not wired to any backend. Submitting only opens a prefilled email. */
export function BetaForm({ t }: { t: Dict['download']['beta'] }) {
  const id = useId()
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'invalid' | 'sent'>('idle')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setState('invalid')
      return
    }
    const body = `${t.mailBody}\n\n${email.trim()}`
    window.location.href = `mailto:${site.betaEmail}?subject=${encodeURIComponent(t.subject)}&body=${encodeURIComponent(body)}`
    setState('sent')
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3" data-placeholder-form="not-connected">
      <Label htmlFor={`${id}-email`} className="text-[13px] font-medium">
        {t.label}
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={`${id}-email`}
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder={t.placeholder}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (state !== 'idle') setState('idle')
          }}
          aria-invalid={state === 'invalid' || undefined}
          aria-describedby={`${id}-note ${id}-msg`}
          className="h-11 bg-white text-[15px]"
        />
        <Button type="submit" className="h-11 rounded-md px-5">
          <Mail className="size-4" aria-hidden />
          {t.submit}
        </Button>
      </div>
      <p id={`${id}-msg`} role="status" className="min-h-5 text-[13px]">
        {state === 'invalid' && <span className="text-destructive">{t.invalid}</span>}
        {state === 'sent' && <span className="text-foreground/80">{t.thanks}</span>}
      </p>
      <p
        id={`${id}-note`}
        className="flex gap-2 rounded-lg border border-dashed px-3 py-2.5 text-[12.5px] leading-relaxed"
        style={{ borderColor: 'var(--tk-yellow-accent)', background: 'color-mix(in srgb, var(--tk-yellow-bg) 45%, white)', color: 'var(--tk-yellow-ink)' }}
      >
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t.placeholderNote}
      </p>
    </form>
  )
}
