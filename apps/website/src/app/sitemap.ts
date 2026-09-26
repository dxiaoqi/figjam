import type { MetadataRoute } from 'next'
import { site } from '@/config/site'
import { scenarioSlugs } from '@/content/scenarios'
import { localePath } from '@/i18n'
import { htmlLang, locales } from '@/i18n/config'

export const dynamic = 'force-static'

const pages: { path: string; priority: number; changeFrequency: 'weekly' | 'monthly' }[] = [
  { path: '/', priority: 1, changeFrequency: 'weekly' },
  { path: '/scenarios/', priority: 0.9, changeFrequency: 'monthly' },
  ...scenarioSlugs.map((s) => ({ path: `/scenarios/${s}/`, priority: 0.8, changeFrequency: 'monthly' as const })),
  { path: '/download/', priority: 0.9, changeFrequency: 'weekly' },
  { path: '/docs/', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/changelog/', priority: 0.5, changeFrequency: 'weekly' },
  { path: '/privacy/', priority: 0.3, changeFrequency: 'monthly' },
]

export default function sitemap(): MetadataRoute.Sitemap {
  const abs = (p: string) => new URL(p, site.url).toString()
  const lastModified = new Date()
  return pages.flatMap(({ path, priority, changeFrequency }) =>
    locales.map((locale) => ({
      url: abs(localePath(locale, path)),
      lastModified,
      changeFrequency,
      priority,
      alternates: { languages: Object.fromEntries(locales.map((l) => [htmlLang[l], abs(localePath(l, path))])) },
    })),
  )
}
