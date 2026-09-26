// Screenshots of every page in both languages, desktop and mobile.
// usage: node scripts/screenshots.mjs <out-dir> [--base=http://127.0.0.1:47900] [--full] [--pages=/,/docs/]
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const out = args.find((a) => !a.startsWith('--')) ?? 'screenshots'
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d
const base = opt('base', 'http://127.0.0.1:47900')
const full = args.includes('--full')
const pages = opt('pages', '/,/download/,/docs/,/changelog/').split(',')
const viewports = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 2 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
}

mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/local/bin/google-chrome' })
for (const [vp, conf] of Object.entries(viewports)) {
  const ctx = await browser.newContext({ viewport: { width: conf.width, height: conf.height }, deviceScaleFactor: conf.deviceScaleFactor, isMobile: conf.isMobile, hasTouch: conf.hasTouch })
  const page = await ctx.newPage()
  for (const locale of ['zh', 'en']) {
    for (const p of pages) {
      await page.goto(`${base}/${locale}${p}`, { waitUntil: 'networkidle' })
      await page.evaluate(async () => {
        // reveal everything that fades in on scroll
        for (let y = 0; y < document.body.scrollHeight; y += 600) {
          window.scrollTo({ top: y, behavior: 'instant' })
          await new Promise((r) => setTimeout(r, 60))
        }
        window.scrollTo({ top: 0, behavior: 'instant' })
        await document.fonts.ready
      })
      await page.waitForTimeout(700)
      const name = `${p === '/' ? 'home' : p.replaceAll('/', '')}-${locale}-${vp}${full ? '-full' : ''}.png`
      await page.screenshot({ path: join(out, name), fullPage: full })
      console.log(name)
    }
  }
  await ctx.close()
}
await browser.close()
