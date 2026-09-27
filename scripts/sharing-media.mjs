// Screenshots, clips and samples for local files and sharing: the storage panel (en, zh), a video block, share
// packs (export, import, a refused pack), and an exported web page opened from file://.
// usage: node scripts/sharing-media.mjs <out-dir> [--skip-build]
//   Builds the canvas and runs its own core on a spare port with a temporary AIFIG_HOME. Writes PNGs, MP4 clips,
//   sample-board.aifigpack and sample-web-page.zip to <out-dir>.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { register } from 'tsx/esm/api'
import { authHeaders, tokenFor } from './lib/core-auth.mjs'
import { startClip } from './lib/clip.mjs'

register()
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.resolve(process.argv[2] ?? 'sharing-media')
fs.mkdirSync(out, { recursive: true })
if (!process.argv.includes('--skip-build')) execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aifig-sharing-media-'))
const home = path.join(tmp, 'aifig')
const port = 48310 + Math.floor(Math.random() * 40) * 2
const base = `http://127.0.0.1:${port}`
const env = { ...process.env, AIFIG_HOME: home, AIFIG_CORE_PORT: String(port), AIFIG_REVEAL: 'off', AIFIG_PACK_DIR: path.join(tmp, 'Documents', 'ai-figma') }
delete env.AIFIG_TOKEN
const bin = path.join(root, 'bin/aifig.mjs')
const HUMAN = { id: 'human:media', name: 'You', client: 'test', kind: 'human' }
const call = async (tool, args = {}) => {
  const r = await (await fetch(`${base}/api/call`, { method: 'POST', headers: authHeaders(home), body: JSON.stringify({ tool, args, caller: HUMAN }) })).json()
  if (!r.ok) throw new Error(`${tool}: ${r.error}`)
  return r.result
}
const core = spawn(process.execPath, [bin, 'core', '--port', String(port)], { env, stdio: 'ignore' })
for (let i = 0; i < 150 && !(await fetch(`${base}/api/health`).then((r) => r.ok, () => false)); i++) await sleep(100)

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/local/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })

// ---- the board: the prototype-kit sample, plus a recorded walkthrough and a sketch -----------------------------
const sample = await call('open_sample', { skill: 'prototype-kit', language: 'en' })
const board = sample.board.id
const blocks = await call('get_board', { board, format: 'json' })
const all = [...blocks.blocks, ...blocks.frames.flatMap((f) => [f, ...f.children])]
const variantB = all.find((b) => b.kind === 'web' && /^B/.test(b.web.title ?? b.text))
const variantC = all.find((b) => b.kind === 'web' && /^C/.test(b.web.title ?? b.text))
const brief = all.find((b) => b.kind === 'frame' && b.title === 'Brief')

async function renderSnippet(b, size, act) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;font:14px/1.45 Inter,system-ui,sans-serif}${b.web.css ?? ''}</style></head><body>${b.web.html ?? ''}<script>window.aifig={getState:async()=>({}),setState:async()=>true,onState(){}};${b.web.js ?? ''}</script></body></html>`)
  await page.waitForTimeout(400)
  const r = await act(page)
  await ctx.close()
  return r
}
const walkthrough = path.join(tmp, 'one-click-detect-walkthrough.mp4')
await renderSnippet(variantB, { width: 960, height: 600 }, async (page) => {
  const stop = await startClip(page, tmp)
  await page.waitForTimeout(700)
  for (const el of await page.$$('button')) {
    await el.hover().catch(() => {})
    await page.waitForTimeout(350)
    await el.click().catch(() => {})
    await page.waitForTimeout(900)
  }
  await page.waitForTimeout(600)
  await stop(walkthrough)
})
const sketch = path.join(tmp, 'variant-c-sketch.png')
await renderSnippet(variantC, { width: 880, height: 560 }, (page) => page.screenshot({ path: sketch }))
const video = await call('add_video', { board, path: walkthrough, inside: brief.id, caption: 'B · walkthrough' })
await call('add_image', { board, path: sketch, inside: brief.id, width: 320, caption: 'C · screenshot' })
await call('review_change_set', { board, id: 'all', action: 'accept' })
await call('tidy', { board, frame: brief.id })
await call('create_version', { board, name: 'Ready to share' })

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
await ctx.addInitScript((t) => {
  try {
    localStorage.setItem('aifig:token', t)
    localStorage.setItem('aifig:welcome', 'done')
  } catch {}
}, tokenFor(home))
const page = await ctx.newPage()
const shot = (name, p = page) => p.screenshot({ path: path.join(out, name) })
const open = async (id, locale) => {
  await page.goto(`${base}/?board=${id}`)
  if (locale) {
    await page.evaluate((l) => localStorage.setItem('aifig:locale', l), locale)
    await page.reload()
  }
  await page.waitForSelector('.ae-block', { timeout: 20000 })
  await page.waitForTimeout(1800)
}
const focus = (id, pad = 60) =>
  page.evaluate(
    ([i, p]) => {
      const r = window.editor.pageRect(i)
      window.editor.zoomToBounds({ x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p }, { animate: false, maxZoom: 1.2 })
    },
    [id, pad],
  )

// ---- canvas: the video plays inline ------------------------------------------------------------------------
await open(board, 'en')
await focus(brief.id, 40)
await page.waitForTimeout(1500)
await page.locator(`[data-block-id="${video.id}"] [data-video-play]`).click()
await page.waitForTimeout(1800)
await shot('canvas-video-inline.png')
await page.keyboard.press('Escape')

// ---- storage panel (en, clip; zh) ----------------------------------------------------------------------------
await page.evaluate(() => window.editor.zoomToFit(false))
await page.waitForTimeout(600)
let stop = await startClip(page, tmp)
await page.waitForTimeout(500)
await page.evaluate(() => window.dispatchEvent(new Event('aifig:storage')))
await page.waitForSelector('[data-storage-asset]')
await page.waitForTimeout(1400)
await shot('storage-panel.png')
for (const f of ['video', 'snippet', 'image', 'all']) {
  await page.click(`[data-storage-filter="${f}"]`)
  await page.waitForTimeout(900)
}
await page.hover('[data-storage-asset]:first-child')
await page.waitForTimeout(700)
await page.locator('[data-storage-used-by]').first().click()
await page.waitForTimeout(1500)
await stop(path.join(out, 'storage-panel.mp4'))
await open(board, 'zh-CN')
await page.evaluate(() => window.dispatchEvent(new Event('aifig:storage')))
await page.waitForSelector('[data-storage-asset]')
await page.waitForTimeout(1200)
await shot('storage-panel-zh.png')
await page.keyboard.press('Escape')
await open(board, 'en')

// ---- share pack ------------------------------------------------------------------------------------------------
const pack = path.join(out, 'sample-board.aifigpack')
fs.rmSync(pack, { force: true })
const px = await call('export_pack', { board, path: pack, include_history: true, include_comments: true })
await page.evaluate(() => window.dispatchEvent(new Event('aifig:export-pack')))
await page.waitForSelector('[data-export-pack]')
await page.click('[data-pack-history]')
await page.waitForTimeout(700)
await shot('pack-export.png')
await page.keyboard.press('Escape')
// someone else opens it
const other = (await call('create_board', { title: 'Inbox' })).board.id
await open(other, 'en')
stop = await startClip(page, tmp)
await page.waitForTimeout(600)
await page.evaluate(() => window.dispatchEvent(new CustomEvent('aifig:import-pack', { detail: {} })))
await page.waitForSelector('[data-import-pack]')
await page.waitForTimeout(700)
await page.setInputFiles('[data-pack-input]', pack)
await page.waitForSelector('[data-pack-preview]', { timeout: 20000 })
await page.waitForTimeout(1600)
await shot('pack-import.png')
await page.click('[data-pack-import]')
await page.waitForSelector('[data-import-pack]', { state: 'detached', timeout: 20000 })
await page.waitForTimeout(2600)
await shot('pack-imported-board.png')
await stop(path.join(out, 'pack-import.mp4'))
{
  const { zipEntries } = await import('../packages/core/src/zip.ts')
  const evil = path.join(tmp, 'totally-safe.aifigpack')
  fs.writeFileSync(evil, zipEntries([{ name: 'manifest.json', data: Buffer.from('{"format":"aifigpack","version":1,"files":[]}') }, { name: '../../.ssh/authorized_keys', data: Buffer.from('ssh-ed25519 AAAA… attacker') }]))
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('aifig:import-pack', { detail: {} })))
  await page.setInputFiles('[data-pack-input]', evil)
  await page.waitForSelector('[data-pack-error]', { timeout: 10000 })
  await page.waitForTimeout(500)
  await shot('pack-refused.png')
  await page.keyboard.press('Escape')
}

// ---- web page --------------------------------------------------------------------------------------------------
await open(board, 'en')
await page.evaluate(() => window.dispatchEvent(new Event('aifig:export-web')))
await page.waitForSelector('[data-web-export] [data-web-mode="zip"]')
await page.waitForTimeout(900)
await shot('web-export-dialog.png')
await page.keyboard.press('Escape')
const zip = path.join(out, 'sample-web-page.zip')
fs.rmSync(zip, { force: true })
const wz = await call('export_web', { board, path: zip, mode: 'zip' })
const folder = path.join(tmp, 'web', 'Connect-an-agent screen (web)')
const wf = await call('export_web', { board, path: folder, mode: 'folder' })
await ctx.close()

const wctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const net = []
wctx.on('request', (r) => !/^(file|data|blob|about):/.test(r.url()) && net.push(r.url()))
wctx.on('requestfailed', (r) => /csp/i.test(r.failure()?.errorText ?? '') && net.splice(net.indexOf(r.url()), 1))
const wp = await wctx.newPage()
stop = await startClip(wp, tmp)
await wp.goto(`file://${wf.open}`)
await wp.waitForSelector('[data-viewer] .ae-block', { timeout: 20000 })
await wp.waitForTimeout(2500)
await shot('web-page.png', wp)
const webFocus = (id) =>
  wp.evaluate((i) => {
    const r = window.editor.pageRect(i)
    window.editor.zoomToBounds({ x: r.x - 60, y: r.y - 60, w: r.w + 120, h: r.h + 120 }, { maxZoom: 1.1 })
  }, id)
const frameB = blocks.frames.find((f) => f.children.some((c) => c.id === variantB.id))
await webFocus(frameB.id)
await wp.waitForTimeout(1200)
await wp.click(`[data-viewer-snippet="${variantB.id}"] [data-snippet-activate]`)
await wp.waitForTimeout(500)
const fb = wp.frames().find((f) => f.url().endsWith(`snippets/${variantB.id}.html`))
for (const el of (await fb?.$$('button')) ?? []) {
  await el.click().catch(() => {})
  await wp.waitForTimeout(700)
}
await shot('web-page-snippet-running.png', wp)
await wp.mouse.click(40, 450)
await webFocus(brief.id)
await wp.waitForTimeout(1200)
await wp.locator('[data-video-play]').first().click()
await wp.waitForTimeout(2200)
await shot('web-page-video.png', wp)
await wp.evaluate(() => window.editor.zoomToFit())
await wp.waitForTimeout(900)
await wp.locator('[data-viewer-pin]').first().click()
await wp.waitForTimeout(1200)
await wp.click('[data-toggle-theme]')
await wp.waitForTimeout(900)
await shot('web-page-dark-comments.png', wp)
await wp.click('[data-toggle-comments]')
await wp.waitForTimeout(700)
await stop(path.join(out, 'web-page.mp4'))
await wctx.close()
await browser.close()
core.kill('SIGTERM')

const clipLen = (f) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout.trim())
console.log(JSON.stringify({
  pack: { file: pack, size: px.size, files: px.files, includes: px.includes },
  web: { zip, size: wz.size, files: wz.files, folderFiles: wf.files },
  networkRequestsFromTheWebPage: net,
  clips: fs.readdirSync(out).filter((f) => f.endsWith('.mp4')).map((f) => `${f} ${clipLen(path.join(out, f)).toFixed(1)}s`),
  shots: fs.readdirSync(out).filter((f) => f.endsWith('.png')),
}, null, 2))
fs.rmSync(tmp, { recursive: true, force: true })
