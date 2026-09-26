// CPU-profile one interaction on a board and print the hottest functions (self time).
// usage: node scripts/bench/profile.mjs <app-url> <board-id> <scenario: open|pan|zoom|select|drag|hover> [top=30]
// Point it at the Vite dev server (`npm run dev`) for readable function names.
import { chromium } from 'playwright-core'

const [base, board, scenario = 'select', top = '30'] = process.argv.slice(2)
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/local/bin/google-chrome', args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.error('page error:', e.message))
const cdp = await page.context().newCDPSession(page)
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
if (scenario === 'open') await cdp.send('Profiler.start')
await page.goto(`${base}/?board=${board}&perf`)
await page.waitForFunction(() => window.editor && window.editor.blocks().length > 0, null, { timeout: 120000 })
await page.waitForTimeout(scenario === 'open' ? 1500 : 3000)
const ed = (fn, a) => page.evaluate(fn, a)
if (scenario !== 'open') {
  await ed((z) => window.editor.setCamera({ x: 200, y: 120, z }), scenario === 'pan40' ? 0.4 : 1)
  await page.waitForTimeout(800)
  await cdp.send('Profiler.start')
}
const t0 = Date.now()
if (scenario === 'pan' || scenario === 'pan40') await ed(() => new Promise((r) => { let i = 0; const f = () => { window.editor.panBy(-14, -6); if (++i < 120) requestAnimationFrame(f); else r() }; requestAnimationFrame(f) }))
if (scenario === 'zoom') await ed(() => new Promise((r) => { let i = 0; const f = () => { window.editor.zoomAt({ x: 720, y: 450 }, Math.exp(-2.5 * (i < 60 ? i / 60 : (120 - i) / 60))); if (++i < 120) requestAnimationFrame(f); else r() }; requestAnimationFrame(f) }))
if (scenario === 'select') for (let i = 0; i < 6; i++) await page.mouse.click(100 + i * 150, 180)
if (scenario === 'hover') for (let i = 0; i < 60; i++) await page.mouse.move(80 + i * 14, 140 + (i % 10) * 50)
if (scenario === 'drag') {
  await page.mouse.move(420, 300)
  await page.mouse.down()
  for (let i = 1; i <= 30; i++) await page.mouse.move(420 + i * 3, 300 + i * 2)
  await page.mouse.up()
}
await page.waitForTimeout(300)
const { profile } = await cdp.send('Profiler.stop')
console.log(`${scenario}: ${Date.now() - t0} ms wall`)
const byId = new Map(profile.nodes.map((n) => [n.id, n]))
const self = new Map()
const dt = profile.timeDeltas
profile.samples.forEach((id, i) => {
  const n = byId.get(id)
  const f = n.callFrame
  const key = `${f.functionName || '(anon)'} ${f.url.split('/').slice(-2).join('/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000)
})
// CALLERS=<functionName> prints the heaviest call stacks leading to that function
if (process.env.CALLERS) {
  const parent = new Map()
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
  const stacks = new Map()
  profile.samples.forEach((id, i) => {
    if (byId.get(id).callFrame.functionName !== process.env.CALLERS) return
    const names = []
    for (let p = parent.get(id); p && names.length < 12; p = parent.get(p)) names.push(byId.get(p).callFrame.functionName || '(anon)')
    const k = names.join(' < ')
    stacks.set(k, (stacks.get(k) ?? 0) + (dt[i] ?? 0) / 1000)
  })
  for (const [k, v] of [...stacks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) console.log(`${v.toFixed(1)} ms  ${k}`)
}
const total = [...self.values()].reduce((s, v) => s + v, 0)
for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, Number(top))) console.log(`${v.toFixed(1).padStart(9)} ms  ${((v / total) * 100).toFixed(1).padStart(5)}%  ${k}`)
await browser.close()
