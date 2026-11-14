export const locales = ['zh', 'en'] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = 'zh'

export const htmlLang: Record<Locale, string> = { zh: 'zh-CN', en: 'en' }
export const localeLabel: Record<Locale, string> = { zh: '简体中文', en: 'English' }
export const LOCALE_STORAGE_KEY = 'nodboard-site:locale'

export function isLocale(v: string): v is Locale {
  return (locales as readonly string[]).includes(v)
}
