// Media for the scenario skills: each skill's sample board (the output of its scripted MCP run) in the canvas, in
// English and Chinese (<skill>-<lang>.png), the Scenarios tab of the new-board dialog, and a short clip of the flow.
// usage: node scripts/scenarios-media.mjs <out-dir>   (expects `npm run dev`; use a throwaway AIFIG_HOME)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { authHeaders, signIn } from './lib/core-auth.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
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

/** Fit the board (minus UI chrome) and wait for snippet previews and fonts. */
async function showBoard(page, board, wait = 2500) {
  await page.goto(`${base}/?board=${board}`)
  await page.waitForSelector('[data-block-id]', { timeout: 15000 })
  await sleep(wait)
  await page.evaluate(() => window.editor?.zoomToFit({ animate: false }))
  await sleep(900)
}

for (const [locale, sfx] of Object.entries(LANGS)) {
  const { context, page } = await openPage(locale)
  for (const skill of SKILLS) {
    const { board } = await call('open_sample', { skill, language: locale })
    await showBoard(page, board.id, skill === 'prototype-kit' ? 5000 : 2500)
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
  await page.waitForSelector('[data-block-id]', { timeout: 15000 })
  await sleep(1500)
  await page.evaluate(() => window.editor?.zoomToFit())
  await sleep(2200)
  await page.click('button[aria-haspopup="menu"]')
  await page.click('[data-menu-new-board]')
  await page.waitForSelector('[data-scenario-detail]')
  await page.click('[data-scenario="prototype"]')
  await sleep(900)
  await page.click('[data-open-sample]')
  await page.waitForSelector('[data-block-id]', { timeout: 15000 })
  await sleep(4000)
  await page.evaluate(() => window.editor?.zoomToFit())
  await sleep(1800)
  const web = await page.evaluate(() => {
    const b = window.editor.blocks().filter((x) => x.kind === 'web').sort((p, q) => p.x - q.x)[1]
    if (!b) return null
    window.editor.zoomToBounds({ x: b.x - 700, y: b.y - 260, w: b.w + 1400, h: b.h + 520 })
    return b.id
  })
  await sleep(1400)
  if (web) {
    const r = await page.locator(`[data-block-id="${web}"]`).boundingBox()
    await page.mouse.dblclick(r.x + r.width / 2, r.y + r.height / 2)
    await sleep(2500)
    const frame = page.frames().find((f) => f !== page.mainFrame() && f.url().includes('localhost'))
    await frame?.locator('button').first().click().catch(() => {})
    await sleep(1800)
  }
  const video = await page.video().path()
  await context.close()
  const mp4 = path.join(out, 'scenarios-flow.mp4')
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-movflags', '+faststart', mp4])
  fs.rmSync(video)
  console.log(`wrote ${mp4}`)
}
await browser.close()
