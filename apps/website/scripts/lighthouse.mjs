// Lighthouse (mobile and desktop) for pages in both languages, against a running static export (`npm start`).
// usage: node scripts/lighthouse.mjs <out-dir> [--base=http://127.0.0.1:47901] [--pages=/,/scenarios/architecture/]
// Writes one JSON report per run plus summary.json / summary.md. Needs network once for `npx lighthouse`.
// One discarded warm-up run comes first (cold disk and font caches). Serve the export with `npm start`: it sends
// precompressed text like a static host; a streaming compressor held the first frame ~1.2 s in headless Chrome.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const out = args.find((a) => !a.startsWith('--')) ?? 'lighthouse'
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d
const base = opt('base', 'http://127.0.0.1:47901')
const pages = opt('pages', '/,/scenarios/architecture/,/privacy/').split(',')
const chrome = process.env.CHROME_PATH ?? '/usr/local/bin/google-chrome'

mkdirSync(out, { recursive: true })
const rows = []
spawnSync('npx', ['-y', 'lighthouse@12', `${base}/zh/`, `--chrome-path=${chrome}`, '--chrome-flags=--headless=new --no-sandbox', '--output=json', '--output-path=/dev/null', '--quiet'], { stdio: 'ignore' })
for (const locale of ['zh', 'en']) {
  for (const p of pages) {
    for (const form of ['mobile', 'desktop']) {
      const name = `${p === '/' ? 'home' : p.replaceAll('/', '-').replace(/^-|-$/g, '')}-${locale}-${form}`
      const file = join(out, `${name}.json`)
      const r = spawnSync(
        'npx',
        ['-y', 'lighthouse@12', `${base}/${locale}${p}`, ...(form === 'desktop' ? ['--preset=desktop'] : []), `--chrome-path=${chrome}`,
          '--chrome-flags=--headless=new --no-sandbox', '--output=json', `--output-path=${file}`, '--quiet'],
        { stdio: 'inherit' },
      )
      if (r.status !== 0) throw new Error(`lighthouse failed for ${name}`)
      const rep = JSON.parse(readFileSync(file, 'utf8'))
      const score = (id) => Math.round(rep.categories[id].score * 100)
      const row = { page: `/${locale}${p}`, form, performance: score('performance'), accessibility: score('accessibility'), bestPractices: score('best-practices'), seo: score('seo'),
        lcp: rep.audits['largest-contentful-paint'].displayValue, cls: rep.audits['cumulative-layout-shift'].displayValue, tbt: rep.audits['total-blocking-time'].displayValue }
      rows.push(row)
      console.log(Object.values(row).join('  '))
    }
  }
}
writeFileSync(join(out, 'summary.json'), JSON.stringify(rows, null, 2))
const md = ['| Page | Form factor | Performance | Accessibility | Best practices | SEO | LCP | CLS | TBT |', '|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.page} | ${r.form} | ${r.performance} | ${r.accessibility} | ${r.bestPractices} | ${r.seo} | ${r.lcp} | ${r.cls} | ${r.tbt} |`)]
writeFileSync(join(out, 'summary.md'), md.join('\n') + '\n')
