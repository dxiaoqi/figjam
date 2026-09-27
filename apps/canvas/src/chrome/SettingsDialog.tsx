import { Languages, Monitor, Moon, Sparkles, Sun, WandSparkles } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { FEATURES } from '@aifig/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { LOCALES, systemLocale, useLocale, useT, type LocalePref } from '../i18n'

export type ThemePref = 'system' | 'light' | 'dark'

export const openSettings = () => window.dispatchEvent(new Event('aifig:settings'))

function Segmented<T extends string>({ value, options, onChange, name, id }: { value: T; options: { id: T; label: ReactNode; icon?: ReactNode }[]; onChange: (v: T) => void; name: string; id: string }) {
  return (
    <div role="radiogroup" aria-label={name} data-setting={id} className="flex flex-wrap gap-1 rounded-xl bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          data-option={o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] whitespace-nowrap transition-colors',
            value === o.id ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Row({ icon, title, hint, children }: { icon: ReactNode; title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 py-4 first:pt-1 last:pb-1 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 text-muted-foreground">{icon}</span>
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          {hint && <div className="text-xs leading-relaxed text-muted-foreground">{hint}</div>}
        </div>
      </div>
      <div className="shrink-0 sm:w-[300px]">{children}</div>
    </div>
  )
}

export function SettingsDialog({ themePref, setTheme, onShowWelcome }: { themePref: ThemePref; setTheme: (t: ThemePref) => void; onShowWelcome: () => void }) {
  const t = useT()
  const { pref, setPref } = useLocale()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const on = () => setOpen(true)
    window.addEventListener('aifig:settings', on)
    return () => window.removeEventListener('aifig:settings', on)
  }, [])
  const sysName = LOCALES.find((l) => l.id === systemLocale())?.label ?? 'English'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl" data-settings-dialog>
        <DialogHeader>
          <DialogTitle>{t('settings.title')}</DialogTitle>
          <DialogDescription>{t('settings.hint')}</DialogDescription>
        </DialogHeader>
        <div className="divide-y">
          <Row icon={<Languages className="size-4" />} title={t('settings.language')} hint={pref === 'system' ? t('settings.languageSystemNow', { name: sysName }) : undefined}>
            <Segmented<LocalePref>
              id="language"
              name={t('settings.language')}
              value={pref}
              onChange={setPref}
              options={[{ id: 'system', label: t('settings.languageSystem') }, ...LOCALES.map((l) => ({ id: l.id as LocalePref, label: <span lang={l.id}>{l.label}</span> }))]}
            />
          </Row>
          <Row icon={<Sun className="size-4" />} title={t('settings.appearance')}>
            <Segmented<ThemePref>
              id="theme"
              name={t('settings.appearance')}
              value={themePref}
              onChange={setTheme}
              options={[
                { id: 'system', label: t('settings.themeSystem'), icon: <Monitor className="size-3.5" /> },
                { id: 'light', label: t('settings.themeLight'), icon: <Sun className="size-3.5" /> },
                { id: 'dark', label: t('settings.themeDark'), icon: <Moon className="size-3.5" /> },
              ]}
            />
          </Row>
          <Row icon={<WandSparkles className="size-4" />} title={t('settings.welcome')} hint={t('settings.welcomeHint')}>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              data-show-welcome
              onClick={() => {
                setOpen(false)
                onShowWelcome()
              }}
            >
              {t('settings.welcomeShow')}
            </Button>
          </Row>
          {FEATURES.assistant && (
          <Row icon={<Sparkles className="size-4" />} title={t('settings.assistant')} hint={t('settings.assistantHint')}>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                setOpen(false)
                window.dispatchEvent(new Event('aifig:assistant-settings'))
              }}
            >
              {t('settings.assistantOpen')}
            </Button>
          </Row>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
