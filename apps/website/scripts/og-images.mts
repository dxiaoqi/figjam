// Open Graph images (1200×630 PNG) for every page in both languages → public/og/<page>-<locale>.png.
// usage (from the repo root): npx tsx apps/website/scripts/og-images.mts
// Chinese needs a CJK font on the machine (PingFang, Noto Sans CJK or WenQuanYi); CHROME_PATH overrides the browser.
import { mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import sharp from 'sharp'
import { COLORS } from '../../../packages/shared/src/tokens'
import { site } from '../src/config/site'
import { scenarioSlugs, scenarios, type TokenColor } from '../src/content/scenarios'
import enModule from '../src/i18n/dictionaries/en'
import zhModule from '../src/i18n/dictionaries/zh'

// the dictionaries are CommonJS to tsx here, so their default export arrives wrapped once more
const unwrap = <T,>(m: T): T => ((m as { default?: T }).default ?? m)
const en = unwrap(enModule)
const zh = unwrap(zhModule)

const out = fileURLToPath(new URL('../public/og/', import.meta.url))
const inter = readFileSync(createRequire(import.meta.url).resolve('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')).toString('base64')

type Card = { eyebrow: string; title: string; body: string; stickies: { color: TokenColor; text: string }[]; image?: string }

function cards(t: ReturnType<typeof en>, locale: 'zh' | 'en'): Record<string, Card> {
  const s = t.scenarios
  const hero = t.home.hero
  const base: Record<string, Card> = {
    home: {
      eyebrow: hero.eyebrow,
      title: `${hero.titleA}\n${hero.titleB}`,
      body: 'Claude Code · Cursor · MCP',
      stickies: [
        { color: 'yellow', text: hero.stickyA },
        { color: 'teal', text: hero.stickyB },
      ],
    },
    scenarios: {
      eyebrow: s.eyebrow,
      title: s.title,
      body: scenarioSlugs.map((k) => scenarios[k].skill).join(' · '),
      stickies: scenarioSlugs.slice(0, 2).map((k) => ({ color: scenarios[k].color, text: s.items[k].short })),
    },
    download: { eyebrow: t.download.eyebrow, title: t.download.title, body: 'macOS · Windows · Linux', stickies: [{ color: 'blue', text: '.dmg · .exe · .AppImage' }] },
    docs: { eyebrow: t.docs.eyebrow, title: t.docs.title, body: `MCP · CLI · SKILL.md`, stickies: [{ color: 'purple', text: `${site.cli} read` }] },
    changelog: { eyebrow: t.changelog.eyebrow, title: t.changelog.title, body: t.changelog.entries[0].title, stickies: [{ color: 'orange', text: t.changelog.entries[0].date }] },
    privacy: { eyebrow: t.privacy.eyebrow, title: t.privacy.title, body: t.privacy.summary.map((x) => x.title).join(' · '), stickies: [{ color: 'green', text: t.privacy.summary[1].body }] },
  }
  for (const k of scenarioSlugs) {
    const it = s.items[k]
    base[`scenario-${k}`] = {
      eyebrow: `${s.eyebrow} · ${scenarios[k].skill}`,
      title: it.title,
      body: it.tagline,
      stickies: [],
      image: fileURLToPath(new URL(`../public/media/scenarios/${scenarios[k].skill}-${locale}-800.webp`, import.meta.url)),
    }
  }
  return base
}

const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

async function html(c: Card, lang: string) {
  const shot = c.image ? `<img class="shot" src="data:image/png;base64,${(await sharp(c.image).resize({ width: 1100 }).png().toBuffer()).toString('base64')}">` : ''
  const long = c.title.length > (lang === 'en' ? 44 : 20)
  const stickies = c.stickies
    .map((st, i) => {
      const col = COLORS[st.color].light
      return `<div class="sticky" style="background:${col.bg};color:${col.ink};top:${120 + i * 190}px;right:${i ? 70 : 150}px;transform:rotate(${i ? 3 : -4}deg)">${esc(st.text)}</div>`
    })
    .join('')
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>
@font-face{font-family:Inter;src:url(data:font/woff2;base64,${inter}) format('woff2');font-weight:100 900}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;overflow:hidden;font-family:Inter,'PingFang SC','Noto Sans CJK SC','WenQuanYi Micro Hei',sans-serif;color:#1C1917;
background:#FAFAF9 radial-gradient(circle at 1px 1px,rgb(28 25 23/.13) 1px,transparent 0) 0 0/24px 24px;position:relative}
.brand{position:absolute;left:72px;top:64px;display:flex;align-items:center;gap:14px;font-weight:600;font-size:26px;letter-spacing:-.01em}
.eyebrow{position:absolute;left:72px;top:190px;font-size:22px;color:#6b635d;display:flex;align-items:center;gap:10px}
.eyebrow i{width:12px;height:12px;border-radius:3px;background:#5596E6;display:block}
h1{position:absolute;left:72px;top:236px;width:${c.image ? 500 : c.stickies.length ? 720 : 1000}px;font-size:${c.image ? 50 : long ? 56 : 68}px;line-height:1.1;font-weight:650;letter-spacing:${lang === 'en' ? '-.028em' : '0'};white-space:pre-line;text-wrap:balance;word-break:${lang === 'en' ? 'normal' : 'keep-all'}}
p{position:absolute;left:72px;bottom:64px;font-size:22px;color:#57534e}
.shot{position:absolute;left:620px;top:110px;width:720px;border-radius:14px;border:1px solid rgb(0 0 0/.08);box-shadow:0 1px 1px rgb(0 0 0/.04),0 12px 40px rgb(0 0 0/.12)}
.sticky{position:absolute;width:250px;min-height:170px;padding:22px;border-radius:6px;font-size:24px;line-height:1.3;font-weight:500;box-shadow:0 1px 1px rgb(0 0 0/.04),0 10px 30px rgb(0 0 0/.08)}
</style></head><body>
<div class="brand"><svg width="44" height="44" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#1C1917"/><rect x="7" y="7" width="11" height="11" rx="2" fill="${COLORS.yellow.light.bg}"/><rect x="14" y="14" width="11" height="11" rx="3" fill="${COLORS.purple.light.bg}"/></svg>${esc(site.name)}</div>
<div class="eyebrow"><i></i>${esc(c.eyebrow)}</div>
<h1>${esc(c.title)}</h1>
<p>${esc(c.body)}</p>
${stickies}${shot}
</body></html>`
}

mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/local/bin/google-chrome' })
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
for (const [locale, dict, lang] of [
  ['zh', zh(site), 'zh-CN'],
  ['en', en(site), 'en'],
] as const) {
  for (const [name, card] of Object.entries(cards(dict, locale))) {
    await page.setContent(await html(card, lang), { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    const png = await page.screenshot({ type: 'png' })
    const file = `${out}${name}-${locale}.png`
    await sharp(png).png({ palette: true, quality: 90, effort: 10 }).toFile(file)
    console.log(file.split('/public/')[1])
  }
}
await browser.close()
