import { site } from '@/config/site'
import type { Locale } from './config'
import en from './dictionaries/en'
import zh from './dictionaries/zh'

export type { Dict } from './dictionaries/en'

const dictionaries = { en: en(site), zh: zh(site) }

export function getDictionary(locale: Locale) {
  return dictionaries[locale]
}

export function localePath(locale: Locale, path = '/') {
  const clean = path.startsWith('/') ? path : `/${path}`
  return `/${locale}${clean === '/' ? '/' : clean.endsWith('/') ? clean : `${clean}/`}`
}
