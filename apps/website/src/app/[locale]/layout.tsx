import type { Metadata, Viewport } from 'next'
import { notFound } from 'next/navigation'
import { RevealObserver } from '@/components/reveal'
import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'
import { TokenStyle } from '@/components/token-style'
import { site } from '@/config/site'
import { htmlLang, isLocale, locales } from '@/i18n/config'
import { getDictionary } from '@/i18n'
import '../globals.css'

export const dynamicParams = false

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }))
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  if (!isLocale(locale)) return {}
  const t = getDictionary(locale)
  return {
    metadataBase: new URL(site.url),
    title: { default: t.meta.title, template: `%s — ${site.name}` },
    description: t.meta.description,
    icons: { icon: '/favicon.svg' },
    alternates: { languages: { 'zh-CN': '/zh/', en: '/en/' } },
    openGraph: { title: t.meta.title, description: t.meta.description, images: ['/media/final-board.webp'], type: 'website' },
  }
}

export const viewport: Viewport = {
  themeColor: '#FAFAF9',
  width: 'device-width',
  initialScale: 1,
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  const t = getDictionary(locale)
  return (
    <html lang={htmlLang[locale]}>
      <head>
        <TokenStyle />
      </head>
      <body className="min-h-dvh bg-background">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-md focus:bg-foreground focus:px-3 focus:py-2 focus:text-sm focus:text-background"
        >
          {t.nav.skip}
        </a>
        <SiteHeader locale={locale} t={t.nav} />
        <main id="main">{children}</main>
        <SiteFooter locale={locale} t={t} />
        <RevealObserver />
      </body>
    </html>
  )
}
