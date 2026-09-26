'use client'

import { Menu } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { BrandMark, BrandName } from '@/components/brand'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import type { Locale } from '@/i18n/config'
import type { Dict } from '@/i18n'
import { cn } from '@/lib/utils'

export function SiteHeader({ locale, t }: { locale: Locale; t: Dict['nav'] }) {
  const pathname = usePathname() ?? ''
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  const base = `/${locale}`
  const links = [
    { href: `${base}/#features`, label: t.product, match: null },
    { href: `${base}/docs/`, label: t.docs, match: '/docs' },
    { href: `${base}/changelog/`, label: t.changelog, match: '/changelog' },
    { href: `${base}/download/`, label: t.download, match: '/download' },
  ]

  return (
    <header
      className={cn(
        'sticky top-0 z-50 transition-[background-color,box-shadow,border-color] duration-200',
        scrolled ? 'chrome border-b border-border/70' : 'border-b border-transparent bg-transparent',
      )}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-5 sm:px-8">
        <Link href={`${base}/`} className="flex items-center gap-2.5 rounded-md" aria-label={t.home}>
          <BrandMark />
          <BrandName className="text-[15px]" />
          <span className="rounded-full border border-border bg-card px-1.5 py-px text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">
            {t.beta}
          </span>
        </Link>
        <nav aria-label={t.menu} className="hidden md:block">
          <ul className="flex items-center gap-1">
            {links.map((l) => {
              const active = l.match != null && pathname.includes(l.match)
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-[13.5px] transition-colors hover:text-foreground',
                      active ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {l.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <LocaleSwitcher locale={locale} label={t.language} />
          <Button asChild size="sm" className="hidden rounded-full px-4 sm:inline-flex">
            <Link href={`${base}/download/#beta`}>{t.cta}</Link>
          </Button>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label={t.menu}>
                <Menu className="size-5" aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[82vw] max-w-xs">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <BrandMark className="size-5" />
                  <BrandName />
                </SheetTitle>
              </SheetHeader>
              <nav aria-label={t.menu} className="px-4">
                <ul className="flex flex-col">
                  {links.map((l) => (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        onClick={() => setOpen(false)}
                        className="block border-b border-border/60 py-3.5 text-[15px] text-foreground"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
                <Button asChild className="mt-6 w-full rounded-full">
                  <Link href={`${base}/download/#beta`} onClick={() => setOpen(false)}>
                    {t.cta}
                  </Link>
                </Button>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}
