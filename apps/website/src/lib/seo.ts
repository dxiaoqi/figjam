import type { Metadata } from 'next'
import { site } from '@/config/site'
import { getDictionary, localePath } from '@/i18n'
import { htmlLang, type Locale } from '@/i18n/config'

const ogLocale: Record<Locale, string> = { zh: 'zh_CN', en: 'en_US' }

/**
 * Title, description, canonical URL, language alternates and a per-locale Open Graph image
 * (public/og/<og>-<locale>.png, made by scripts/og-images.mjs).
 */
export function pageMetadata({
  locale,
  path,
  title,
  description,
  og,
  absoluteTitle,
}: {
  locale: Locale
  path: string
  title: string
  description: string
  og: string
  absoluteTitle?: boolean
}): Metadata {
  const url = localePath(locale, path)
  const fullTitle = absoluteTitle ? title : `${title} — ${site.name}`
  const image = { url: `/og/${og}-${locale}.png`, width: 1200, height: 630, alt: getDictionary(locale).meta.ogAlt }
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: {
      canonical: url,
      languages: { [htmlLang.zh]: localePath('zh', path), [htmlLang.en]: localePath('en', path), 'x-default': localePath('zh', path) },
    },
    openGraph: {
      type: 'website',
      siteName: site.name,
      title: fullTitle,
      description,
      url,
      locale: ogLocale[locale],
      alternateLocale: ogLocale[locale === 'zh' ? 'en' : 'zh'],
      images: [image],
    },
    twitter: { card: 'summary_large_image', title: fullTitle, description, images: [image] },
  }
}
