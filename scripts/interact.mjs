// Dev helper: exercise direct manipulation in the canvas and check the core received it.
import { chromium } from 'playwright-core'

const base = 'http://127.0.0.1:47820'
const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text().slice(0, 300)))
await page.goto(base)
await page.waitForTimeout(2500)

const outline = async () => {
  const r = await fetch(`${base}/api/call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool: 'get_board', args: { format: 'json' }, caller: { id: 't', name: 't', client: 't', kind: 'human' } }),
  })
  return (await r.json()).result
}

// sticky via keyboard
await page.mouse.click(700, 720)
await page.keyboard.press('s')
await page.mouse.click(760, 700)
await page.waitForTimeout(200)
await page.keyboard.type('Written by a human')
await page.keyboard.press('Escape')
await page.waitForTimeout(600)
let o = await outline()
const all = [...o.blocks, ...o.frames.flatMap((f) => f.children)]
const mine = all.find((b) => b.text === 'Written by a human')
console.log(mine ? `✓ human sticky persisted in core: ${mine.id} at ${mine.x},${mine.y} author=${mine.author?.name}` : '✗ human sticky missing')

// review: accept all
const acceptAll = page.getByRole('button', { name: 'Accept all' })
if (await acceptAll.count()) {
  await acceptAll.click()
  await page.waitForTimeout(800)
  o = await outline()
  console.log(`✓ pending change sets after accept all: ${o.pendingChangeSets.length}`)
}
await page.screenshot({ path: process.argv[2] ?? '/tmp/interact.png' })
await browser.close()
