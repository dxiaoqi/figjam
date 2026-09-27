import Link from 'next/link'
import { BrandMark, BrandName } from '@/components/brand'
import { site } from '@/config/site'
import type { Locale } from '@/i18n/config'
import type { Dict } from '@/i18n'

export function SiteFooter({ locale, t }: { locale: Locale; t: Dict }) {
  const base = `/${locale}`
  const cols = [
    {
      title: t.footer.product,
      links: [
        { href: `${base}/#features`, label: t.nav.product },
        { href: `${base}/download/`, label: t.nav.download },
        { href: `${base}/changelog/`, label: t.nav.changelog },
      ],
    },
    {
      title: t.footer.resources,
      links: [
        { href: `${base}/docs/`, label: t.nav.docs },
        { href: `${base}/docs/#skills`, label: 'SKILL.md' },
        { href: site.repoUrl, label: t.footer.source, external: true },
      ],
    },
  ]
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="max-w-sm">
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <BrandName />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">{t.footer.tagline}</p>
          <p className="mt-2 text-xs text-muted-foreground/80">{t.footer.codename}</p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{c.title}</h2>
            <ul className="mt-4 space-y-2.5">
              {c.links.map((l) => (
                <li key={l.href}>
                  {'external' in l ? (
                    <a href={l.href} className="text-sm text-foreground/80 hover:text-foreground" rel="noreferrer" target="_blank">
                      {l.label}
                    </a>
                  ) : (
                    <Link href={l.href} className="text-sm text-foreground/80 hover:text-foreground">
                      {l.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto flex max-w-6xl items-center justify-between border-t border-border/70 px-5 py-6 text-xs text-muted-foreground sm:px-8">
        <span>{t.footer.rights}</span>
        <span className="font-mono">v{site.version}</span>
      </div>
    </footer>
  )
}
