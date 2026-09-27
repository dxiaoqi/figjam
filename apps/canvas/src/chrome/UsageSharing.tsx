import { BarChart3 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { desktop, type TelemetryStatus } from '@/lib/desktop'
import { cn } from '@/lib/utils'
import { useT } from '../i18n'

/** Desktop builds with a counter endpoint only; everywhere else this is null and the UI stays hidden. */
export function useTelemetry() {
  const [status, setStatus] = useState<TelemetryStatus | null>(null)
  useEffect(() => {
    let live = true
    desktop?.telemetry
      ?.status()
      .then((s) => live && setStatus(s))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  const set = async (granted: boolean) => {
    if (!desktop?.telemetry) return
    setStatus(await desktop.telemetry.set(granted))
  }
  return { status: status?.configured ? status : null, set }
}

/** Opt-in switch for anonymous install counting, with exactly what a ping contains. */
export function UsageSharing({ variant, className }: { variant: 'welcome' | 'settings'; className?: string }) {
  const t = useT()
  const { status, set } = useTelemetry()
  if (!status) return null
  const on = status.consent === 'granted' && !status.envDisabled
  const sample = Object.entries(status.preview).filter(([k]) => k !== 'v')
  const toggle = (
    <Switch
      id={`usage-${variant}`}
      checked={on}
      disabled={status.envDisabled}
      onCheckedChange={(v) => void set(v)}
      aria-describedby={variant === 'welcome' ? 'usage-welcome-body' : undefined}
      data-usage-toggle
      className="mt-0.5"
    />
  )
  const details = (
    <details className="group mt-1.5 text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none hover:text-foreground">{t('usage.whatSent')}</summary>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-lg bg-muted/60 p-2 font-mono text-[11px]">
        {sample.map(([k, v]) => (
          <div key={k} className="contents">
            <dt>{k}</dt>
            <dd className="truncate text-foreground/80">{v ?? t('usage.idWhenOn')}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1.5">{t('usage.never')}</p>
    </details>
  )

  if (variant === 'settings')
    return (
      <div className={cn('flex flex-col gap-1', className)} data-usage-sharing="settings">
        <label htmlFor="usage-settings" className="flex items-center justify-between gap-3 text-[13px]">
          <span>{status.envDisabled ? t('usage.envOff') : on ? t('usage.on') : t('usage.off')}</span>
          {toggle}
        </label>
        {details}
      </div>
    )

  return (
    <div className={cn('flex items-start gap-3 rounded-xl border bg-muted/30 p-3', className)} data-usage-sharing="welcome">
      <BarChart3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <label htmlFor="usage-welcome" className="text-[13px] font-medium">
          {t('usage.title')}
        </label>
        <p id="usage-welcome-body" className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {status.envDisabled ? t('usage.envOff') : t('usage.body')}
        </p>
        {details}
      </div>
      {toggle}
    </div>
  )
}
