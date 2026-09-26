// Screenshots for the distribution work: website Download page, counter dashboard, and the installed desktop app's
// consent UI. Expects the website (47900), the release server (47920) and the counter in mock mode (47910) running,
// and the app installed from the .deb (or pass AIFIG_APP=/path/to/ai-figma).
// usage: node scripts/distribution-media.mjs <out-dir>
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, chromium } from 'playwright-core'

const out = process.argv[2] ?? '/tmp/distribution-media'
fs.mkdirSync(out, { recursive: true })
const site = process.env.SITE ?? 'http://127.0.0.1:47900'
const counter = process.env.COUNTER ?? 'http://127.0.0.1:47910'
const shot = (name) => path.join(out, `${name}.png`)

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/local/bin/google-chrome', args: ['--no-sandbox'] })

// ---- website Download page -------------------------------------------------------------------------------
for (const [locale, width, height, full] of [
  ['en', 1440, 1000, true],
  ['zh', 390, 844, false],
]) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, locale: locale === 'zh' ? 'zh-CN' : 'en-US', reducedMotion: 'reduce' })
  await page.goto(`${site}/${locale}/download/`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-download-state="ready"]', { timeout: 20000 })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: shot(`download-page-${locale}${width < 600 ? '-mobile' : ''}`), fullPage: full })
  if (locale === 'en') {
    await page.locator('[data-platform]').first().scrollIntoViewIfNeeded()
    await page.waitForTimeout(600)
    await page.locator('section[aria-labelledby="all-downloads"]').screenshot({ path: shot('download-checksums') })
    // clicking a download sends the anonymous count
    await page.route('**/*.exe', (r) => r.fulfill({ status: 204 }))
    await page.locator('[data-download-file$="win-x64-setup.exe"]').click()
    await page.waitForTimeout(800)
  }
  await page.close()
}

// ---- counter dashboard ------------------------------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })
  await page.goto(`${counter}/admin`)
  await page.screenshot({ path: shot('dashboard-sign-in') })
  await page.fill('#token', process.env.ADMIN_TOKEN ?? 'mock-admin-token')
  await page.click('#gate button')
  await page.waitForSelector('#dash:not([hidden]) .card .value')
  await page.waitForTimeout(500)
  await page.screenshot({ path: shot('dashboard'), fullPage: true })
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  await mobile.goto(`${counter}/admin`)
  await mobile.fill('#token', process.env.ADMIN_TOKEN ?? 'mock-admin-token')
  await mobile.click('#gate button')
  await mobile.waitForSelector('#dash:not([hidden]) .card .value')
  await mobile.screenshot({ path: shot('dashboard-mobile') })
  await page.close()
  await mobile.close()
}
await browser.close()

// ---- the installed app: welcome step and Settings with the opt-in switch -----------------------------------
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aifig-media-'))
  const port = String(48700 + Math.floor(Math.random() * 100))
  const app = await electron.launch({
    executablePath: process.env.AIFIG_APP ?? '/opt/ai-figma/ai-figma',
    args: [`--user-data-dir=${path.join(tmp, 'profile')}`, '--disable-gpu'],
    env: { ...process.env, AIFIG_HOME: path.join(tmp, 'home'), AIFIG_CORE_PORT: port, AIFIG_TELEMETRY_URL: counter, AIFIG_DESKTOP_KEYCHAIN: 'mock' },
  })
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1280, height: 820 })
  await win.waitForSelector('.ae-canvas', { timeout: 30000 })
  await win.evaluate(() => (location.search = '?welcome=1'))
  await win.waitForSelector('[data-usage-sharing="welcome"]', { timeout: 20000 })
  await win.waitForTimeout(900)
  await win.screenshot({ path: shot('app-welcome-usage-off') })
  await win.locator('[data-usage-sharing="welcome"] summary').click()
  await win.locator('[data-usage-sharing="welcome"] [data-usage-toggle]').click()
  await win.waitForTimeout(1200)
  await win.screenshot({ path: shot('app-welcome-usage-on') })
  await win.locator('[data-welcome-skip]').click()
  await win.waitForTimeout(400)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'settings'))
  await win.waitForSelector('[data-usage-sharing="settings"]', { timeout: 10000 })
  await win.waitForTimeout(600)
  await win.screenshot({ path: shot('app-settings-usage') })
  const status = await win.evaluate(() => window.aifigDesktop.telemetry.status())
  console.log('telemetry status after opting in:', JSON.stringify(status))
  await app.close()
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log(`screenshots in ${out}:\n${fs.readdirSync(out).map((f) => `  ${f}`).join('\n')}`)
