'use client'

import { Check, Languages } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { LOCALE_STORAGE_KEY, type Locale, localeLabel, locales } from '@/i18n/config'

export function switchLocalePath(pathname: string, to: Locale) {
  const parts = pathname.split('/')
  if ((locales as readonly string[]).includes(parts[1])) parts[1] = to
  else parts.splice(1, 0, to)
  const next = parts.join('/')
  return next.endsWith('/') ? next : `${next}/`
}

export function LocaleSwitcher({ locale, label }: { locale: Locale; label: string }) {
  const pathname = usePathname() || `/${locale}/`
  const short = locale === 'zh' ? '中文' : 'EN'
  const go = (to: Locale) => {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, to)
    } catch {}
    window.location.assign(switchLocalePath(pathname, to) + window.location.hash)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 px-2.5 text-muted-foreground hover:text-foreground" aria-label={`${label} (${short})`}>
          <Languages className="size-4" aria-hidden />
          <span className="text-[13px]">{short}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        {locales.map((l) => (
          <DropdownMenuItem key={l} lang={l === 'zh' ? 'zh-CN' : 'en'} onSelect={() => l !== locale && go(l)} className="justify-between">
            {localeLabel[l]}
            {l === locale && <Check className="size-4" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
