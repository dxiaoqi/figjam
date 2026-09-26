// Dev helper: screenshot the running canvas with headless Chrome.
// usage: node scripts/shot.mjs out.png [url] [--dark] [--wait=ms] [--w=1440] [--h=900]
import { chromium } from 'playwright-core'
import { signIn } from './lib/core-auth.mjs'

const args = process.argv.slice(2)
const out = args.find((a) => a.endsWith('.png')) ?? 'shot.png'
const url = args.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:47820/'
const opt = (k, d) => Number(args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d)
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/local/bin/google-chrome', args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: opt('w', 1440), height: opt('h', 900) }, deviceScaleFactor: 2, colorScheme: args.includes('--dark') ? 'dark' : 'light' })
await signIn(page)
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && console.log(`[${m.type()}]`, m.text().slice(0, 300)))
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.goto(url)
await page.waitForTimeout(opt('wait', 2500))
await page.screenshot({ path: out })
console.log(`wrote ${out}`)
await browser.close()
