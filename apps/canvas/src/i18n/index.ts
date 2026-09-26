import { Fragment, createElement, useSyncExternalStore, type ReactNode } from 'react'
import { en, type Plural } from './en'
import { zhCN } from './zh-CN'

export type Locale = 'en' | 'zh-CN'
export type LocalePref = 'system' | Locale
export type MessageKey = keyof typeof en
export type Messages = { [K in MessageKey]: string | Plural }
type Vars = Record<string, string | number>

export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'zh-CN', label: '简体中文' },
]

const dicts: Record<Locale, Messages> = { en, 'zh-CN': zhCN }
const PREF_KEY = 'aifig:locale'

/** First supported language in the OS / browser preference list. */
export function systemLocale(langs: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]): Locale {
  for (const l of langs) {
    if (/^zh/i.test(l)) return 'zh-CN'
    if (/^en/i.test(l)) return 'en'
  }
  return 'en'
}

function readPref(): LocalePref {
  try {
    const v = localStorage.getItem(PREF_KEY)
    return v === 'en' || v === 'zh-CN' ? v : 'system'
  } catch {
    return 'system'
  }
}

let pref: LocalePref = readPref()
let locale: Locale = pref === 'system' ? systemLocale() : pref
const listeners = new Set<() => void>()

function apply() {
  const next = pref === 'system' ? systemLocale() : pref
  if (typeof document !== 'undefined') document.documentElement.lang = next
  if (next === locale) return listeners.forEach((l) => l())
  locale = next
  listeners.forEach((l) => l())
}
if (typeof document !== 'undefined') document.documentElement.lang = locale
if (typeof window !== 'undefined') window.addEventListener('languagechange', () => pref === 'system' && apply())

export const getLocale = () => locale
export const getLocalePref = () => pref

export function setLocalePref(p: LocalePref) {
  pref = p
  try {
    if (p === 'system') localStorage.removeItem(PREF_KEY)
    else localStorage.setItem(PREF_KEY, p)
  } catch {
    /* private mode: the choice lasts for this session */
  }
  apply()
}

export function subscribeLocale(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function lookup(key: MessageKey, vars?: Vars): string {
  const msg = dicts[locale][key] ?? en[key]
  if (typeof msg === 'string') return msg
  const n = Number(vars?.count ?? 0)
  return new Intl.PluralRules(locale).select(n) === 'one' ? msg.one : msg.other
}

/** Translate a key. `{name}` placeholders are filled from `vars`; `{ one, other }` messages pick by `vars.count`. */
export function t(key: MessageKey, vars?: Vars): string {
  const s = lookup(key, vars)
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s
}

/** Label of a connector relation: built-in relations are translated, skill relations show as declared. */
export const relationLabel = (r: string) => (`relation.${r}` in en ? t(`relation.${r}` as MessageKey) : r)

/** Like `t`, but placeholders may be React nodes (e.g. `<code>`), for sentences with inline markup. */
export function tn(key: MessageKey, vars: Record<string, ReactNode>): ReactNode {
  const s = lookup(key, vars as Vars)
  const parts = s.split(/\{(\w+)\}/g)
  return createElement(
    Fragment,
    null,
    ...parts.map((p, i) => (i % 2 ? createElement(Fragment, { key: i }, p in vars ? vars[p] : `{${p}}`) : p)),
  )
}

/** Re-renders the component when the language changes; returns `t`. */
export function useT() {
  useSyncExternalStore(subscribeLocale, getLocale)
  return t
}

export function useLocale() {
  const l = useSyncExternalStore(subscribeLocale, getLocale)
  const p = useSyncExternalStore(subscribeLocale, getLocalePref)
  return { locale: l, pref: p, setPref: setLocalePref }
}

/** Relative time, short ("3m ago" / "3 分钟前"). */
export function ago(ts: number, now = Date.now(), style: 'long' | 'short' = 'long') {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < (style === 'short' ? 45 : 10)) return t('time.justNow')
  const m = Math.round(s / 60)
  const h = Math.round(m / 60)
  const d = Math.round(h / 24)
  const [n, unit] = s < 60 ? (style === 'short' ? [1, 'm'] : [s, 's']) : m < 60 ? [m, 'm'] : h < 24 ? [h, 'h'] : [d, 'd']
  return t(style === 'short' ? 'time.short' : 'time.ago', { n, unit: t(`time.unit.${unit}` as MessageKey) })
}
