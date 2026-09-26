// WCAG 2.2 contrast audit of the design tokens and the app's theme, light and dark.
// Text must reach AA (4.5:1, or 3:1 for large text); connectors and selection outlines are graphics (3:1).
// usage: npm run test:contrast [-- --json]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COLOR_TOKENS, COLORS, SURFACES } from '@aifig/shared'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
type RGB = [number, number, number]
type Theme = 'light' | 'dark'

// ---- color math --------------------------------------------------------------------------------------------

function hex(h: string): RGB {
  const m = h.replace('#', '')
  const f = m.length === 3 ? m.split('').map((c) => c + c).join('') : m
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255) as RGB
}

/** CSS oklch(L C H [/ alpha]) → sRGB (gamut-clipped); alpha is returned separately. */
function oklch(s: string): { rgb: RGB; alpha: number } {
  const m = s.match(/oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?))?\s*\)/)
  if (!m) throw new Error(`not an oklch color: ${s}`)
  const L = m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1])
  const C = parseFloat(m[2])
  const H = (parseFloat(m[3]) * Math.PI) / 180
  const alpha = m[4] ? (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1
  const a = C * Math.cos(H)
  const b = C * Math.sin(H)
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_]
  const enc = (v: number) => Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055))
  return { rgb: lin.map(enc) as RGB, alpha }
}

function parse(c: string): { rgb: RGB; alpha: number } {
  return c.trim().startsWith('#') ? { rgb: hex(c), alpha: 1 } : oklch(c)
}

/** Composite a color with `alpha` (and element opacity) over an opaque background. */
function over(fg: RGB, alpha: number, bg: RGB): RGB {
  return fg.map((v, i) => v * alpha + bg[i] * (1 - alpha)) as RGB
}

function luminance([r, g, b]: RGB) {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function contrast(a: RGB, b: RGB) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

// ---- app theme (shadcn variables in index.css) ---------------------------------------------------------------

function themeVars(): Record<Theme, Record<string, string>> {
  const css = fs.readFileSync(path.join(root, 'apps/canvas/src/index.css'), 'utf8')
  const block = (sel: RegExp) => {
    const m = css.match(sel)
    if (!m) throw new Error(`theme block ${sel} not found in index.css`)
    return Object.fromEntries([...m[1].matchAll(/--([a-z-]+):\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]))
  }
  return { light: block(/:root\s*{([^}]*)}/), dark: block(/\.dark\s*{([^}]*)}/) }
}

// ---- checks -------------------------------------------------------------------------------------------------

interface Check {
  theme: Theme
  what: string
  fg: string
  bg: string
  opacity?: number
  /** 'text' (4.5), 'large' (3, ≥24px or ≥18.66px bold), 'graphic' (3). */
  kind: 'text' | 'large' | 'graphic'
}

/** `opacity` of the first rule for `selector` in index.css (type headers, fields, done items fade their text). */
function cssOpacity(selector: string) {
  const css = fs.readFileSync(path.join(root, 'apps/canvas/src/index.css'), 'utf8')
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = css.match(new RegExp(`(?:^|\\n|,)\\s*${esc}\\s*{([^}]*)}`))
  const v = m?.[1].match(/opacity:\s*([\d.]+)/)?.[1]
  if (!v) throw new Error(`no opacity for ${selector} in index.css`)
  return Number(v)
}

const checks: Check[] = []
const vars = themeVars()
const headerOpacity = cssOpacity('.aifig-type-header')
const fieldsOpacity = cssOpacity('.aifig-type-footer')
const doneOpacity = cssOpacity('.aifig-card.is-done .title')
const pctOf = (o: number) => `${Math.round(o * 100)}%`
for (const t of ['light', 'dark'] as Theme[]) {
  const s = SURFACES[t]
  // canvas content (tokens; same values drive the core's PNG / SVG snapshots)
  for (const c of COLOR_TOKENS) {
    const p = COLORS[c][t]
    checks.push({ theme: t, what: `sticky text · ${c}`, fg: p.ink, bg: p.bg, kind: 'text' })
    checks.push({ theme: t, what: `sticky type header (78%) · ${c}`, fg: p.ink, bg: p.bg, opacity: 0.78, kind: 'text' })
    checks.push({ theme: t, what: `sticky type fields (78%) · ${c}`, fg: p.ink, bg: p.bg, opacity: 0.78, kind: 'text' })
    checks.push({ theme: t, what: `card type header · ${c}`, fg: t === 'light' ? p.ink : p.accent, bg: s.surface, kind: 'text' })
  }
  for (const [bgName, bg] of [['canvas', s.canvas], ['surface', s.surface], ['frame', s.frame]] as const) {
    checks.push({ theme: t, what: `ink on ${bgName}`, fg: s.ink, bg, kind: 'text' })
    checks.push({ theme: t, what: `muted on ${bgName}`, fg: s.muted, bg, kind: 'text' })
  }
  checks.push({ theme: t, what: 'card type fields (78%)', fg: s.ink, bg: s.surface, opacity: 0.78, kind: 'text' })
  checks.push({ theme: t, what: 'done todo title (60%)', fg: s.ink, bg: s.surface, opacity: 0.6, kind: 'text' })
  checks.push({ theme: t, what: 'connector on canvas', fg: s.connector, bg: s.canvas, kind: 'graphic' })
  checks.push({ theme: t, what: 'connector on frame', fg: s.connector, bg: s.frame, kind: 'graphic' })
  const accent = t === 'light' ? '#5b5bd6' : '#8e8cf0'
  checks.push({ theme: t, what: 'selected frame title (accent)', fg: accent, bg: s.canvas, kind: 'text' })
  checks.push({ theme: t, what: 'selection outline (accent)', fg: accent, bg: s.surface, kind: 'graphic' })
  // app chrome
  const v = vars[t]
  for (const bg of ['background', 'card', 'popover', 'muted', 'accent', 'secondary']) {
    checks.push({ theme: t, what: `chrome foreground on ${bg}`, fg: v.foreground, bg: v[bg], kind: 'text' })
    checks.push({ theme: t, what: `chrome muted-foreground on ${bg}`, fg: v['muted-foreground'], bg: v[bg], kind: 'text' })
  }
  checks.push({ theme: t, what: 'chrome primary button', fg: v['primary-foreground'], bg: v.primary, kind: 'text' })
  checks.push({ theme: t, what: 'chrome destructive text', fg: v.destructive, bg: v.background, kind: 'text' })
  checks.push({ theme: t, what: 'chrome focus ring', fg: v.ring, bg: v.background, kind: 'graphic' })
}

const results = checks.map((c) => {
  const bg = parse(c.bg)
  const fg = parse(c.fg)
  const bgRgb = bg.alpha < 1 ? over(bg.rgb, bg.alpha, parse(vars[c.theme].background).rgb) : bg.rgb
  const ratio = contrast(over(fg.rgb, fg.alpha * (c.opacity ?? 1), bgRgb), bgRgb)
  const min = c.kind === 'text' ? 4.5 : 3
  return { ...c, ratio: Math.round(ratio * 100) / 100, min, ok: ratio >= min }
})

if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 2))
else {
  for (const r of results) if (!r.ok || process.argv.includes('--all')) console.log(`${r.ok ? '✓' : '✗'} ${r.theme.padEnd(5)} ${r.what.padEnd(40)} ${r.ratio.toFixed(2).padStart(6)} (≥ ${r.min})`)
  const failed = results.filter((r) => !r.ok).length
  const lowest = [...results].sort((a, b) => a.ratio / a.min - b.ratio / b.min)[0]
  console.log(`${results.length - failed}/${results.length} pairs meet WCAG AA (tightest: ${lowest.theme} ${lowest.what}, ${lowest.ratio}:1)`)
  process.exit(failed ? 1 : 0)
}
