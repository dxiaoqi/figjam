// Media for the scenario skills: each skill's sample board (the output of its scripted MCP run) in the canvas, in
// English and Chinese (<skill>-<lang>.png), the Scenarios tab of the new-board dialog, and a short clip of the flow.
// usage: node scripts/scenarios-media.mjs <out-dir>   (expects `npm run dev`; use a throwaway AIFIG_HOME)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { authHeaders, signIn } from './lib/core-auth.mjs'

const out = path.resolve(process.argv[2] ?? 'scenarios-media')
fs.mkdirSync(out, { recursive: true })
const base = 'http://127.0.0.1:47820'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PERSON = { id: 'human:media', name: 'You', client: 'media', kind: 'human' }
const call = async (tool, args = {}) => {
  const r = await (await fetch('http://127.0.0.1:47821/api/call', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ tool, args, caller: PERSON }) })).json()
  if (!r.ok) throw new Error(`${tool}: ${r.error}`)
  return r.result
}
const SKILLS = ['arch-kit', 'research-kit', 'product-kit', 'prototype-kit', 'lit-kit']
const LANGS = { en: 'en', 'zh-CN': 'zh' }

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/local/bin/google-chrome', args: ['--no-sandbox'] })
async function openPage(locale, video) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, ...(video ? { recordVideo: { dir: out, size: { width: 1600, height: 1000 } } } : {}) })
  const page = await context.newPage()
  await signIn(page)
  await context.addInitScript((l) => {
    try {
      localStorage.setItem('aifig:locale', l)
      localStorage.setItem('aifig:welcomed', '1')
    } catch {
      /* snippet frames have no storage */
    }
  }, locale)
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  return { context, page }
}

/** The frames each hero shot focuses on (by position in the sample: first frames first). */
const FOCUS = { 'arch-kit': [0, 1], 'research-kit': [1, 2], 'product-kit': [1, 2, 3], 'prototype-kit': [0, 1, 2, 3], 'lit-kit': [2] }

/** Open a board and wait for snippet previews and fonts; then fit the whole board, or just some frames. */
async function showBoard(page, board, wait = 2500) {
  await page.goto(`${base}/?board=${board}`)
  await page.waitForSelector('[data-block-id]', { state: 'attached', timeout: 15000 })
  await sleep(wait)
  await page.evaluate(() => window.editor?.zoomToFit({ animate: false }))
  await sleep(900)
}
async function focus(page, picks) {
  await page.evaluate((picks) => {
    const ed = window.editor
    const frames = ed.blocks().filter((b) => b.kind === 'frame' && !b.parent).sort((a, b) => a.y - b.y || a.x - b.x)
    const rects = picks.map((i) => frames[i]).filter(Boolean).map((f) => ed.pageRect(f.id))
    const x = Math.min(...rects.map((r) => r.x))
    const y = Math.min(...rects.map((r) => r.y))
    const w = Math.max(...rects.map((r) => r.x + r.w)) - x
    // tall regions: keep the top, at the viewport's aspect ratio, so the shot stays readable
    const h = Math.min(Math.max(...rects.map((r) => r.y + r.h)) - y, (w + 80) / (innerWidth / innerHeight) - 160)
    ed.zoomToBounds({ x: x - 40, y: y - 90, w: w + 80, h: h + 160 }, { animate: false })
  }, picks)
  await sleep(900)
}

for (const [locale, sfx] of Object.entries(LANGS)) {
  const { context, page } = await openPage(locale)
  for (const skill of SKILLS) {
    const { board } = await call('open_sample', { skill, language: locale })
    await showBoard(page, board.id, skill === 'prototype-kit' ? 5000 : 2500)
    await page.screenshot({ path: path.join(out, `${skill}-${sfx}-overview.png`) })
    await focus(page, FOCUS[skill])
    const file = path.join(out, `${skill}-${sfx}.png`)
    await page.screenshot({ path: file })
    console.log(`wrote ${file}`)
  }
  // the Scenarios tab of the new-board dialog
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('aifig:new-board', { detail: 'scenario:architecture' })))
  await page.waitForSelector('[data-scenario-detail]')
  await sleep(500)
  await page.screenshot({ path: path.join(out, `scenarios-dialog-${sfx}.png`) })
  console.log(`wrote ${path.join(out, `scenarios-dialog-${sfx}.png`)}`)
  await context.close()
}

// clip: New board ▸ Scenarios ▸ Architecture ▸ Create, then the sample boards (prototype variants run live)
{
  const { context, page } = await openPage('en', true)
  const blank = await call('create_board', { title: 'Untitled board', language: 'en' })
  await page.goto(`${base}/?board=${blank.board.id}`)
  await sleep(1800)
  await page.click('[data-empty-state] [data-scenario-chip="architecture"]')
  await page.waitForSelector('[data-scenario-detail]')
  await sleep(1400)
  for (const id of ['research', 'product', 'prototype', 'literature', 'architecture']) {
    await page.click(`[data-scenario="${id}"]`)
    await sleep(900)
  }
  await page.click('[data-new-board-create]')
  await page.waitForSelector('[data-block-id]', { state: 'attached', timeout: 15000 })
  await sleep(1500)
  await page.evaluate(() => window.editor?.zoomToFit())
  await sleep(2200)
  await page.click('button[aria-haspopup="menu"]')
  await page.click('[data-menu-new-board]')
  await page.waitForSelector('[data-new-board-dialog]')
  await page.click('[data-new-board-tab-trigger="scenarios"]')
  await page.waitForSelector('[data-scenario-detail]')
  await page.click('[data-scenario="prototype"]')
  await sleep(900)
  await page.click('[data-open-sample]')
  await page.waitForSelector('[data-block-id]', { state: 'attached', timeout: 15000 })
  await sleep(4000)
  await page.evaluate(() => window.editor?.zoomToFit())
  await sleep(1800)
  const web = await page.evaluate(() => {
    const ed = window.editor
    const b = ed.blocks().filter((x) => x.kind === 'web').sort((p, q) => ed.pageRect(p.id).x - ed.pageRect(q.id).x)[1]
    if (!b) return null
    const r = ed.pageRect(b.id)
    ed.zoomToBounds({ x: r.x - 700, y: r.y - 260, w: r.w + 1400, h: r.h + 520 }, { animate: false })
    return b.id
  })
  await sleep(1400)
  if (web) {
    // off-center: a connector may cross the middle of the snippet
    const p = await page.evaluate((id) => {
      const r = window.editor.pageRect(id)
      return window.editor.pageToScreen({ x: r.x + r.w * 0.25, y: r.y + r.h * 0.8 })
    }, web)
    await page.mouse.dblclick(p.x, p.y)
    await sleep(2500)
    // a locator click would scroll the canvas and land outside (which stops the snippet), and the canvas is
    // CSS-scaled, so point the cursor at the button and press it from inside the frame
    const btn = page.frameLocator('[data-web-frame]').locator('button').first()
    const box = await btn.boundingBox().catch(() => null)
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 })
    await sleep(500)
    await btn.evaluate((b) => b.click()).catch((e) => console.log('snippet click:', e.message.split('\n')[0]))
    await sleep(2400)
  }
  const video = await page.video().path()
  await context.close()
  const mp4 = path.join(out, 'scenarios-flow.mp4')
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-movflags', '+faststart', mp4])
  fs.rmSync(video)
  console.log(`wrote ${mp4}`)
}
await browser.close()
