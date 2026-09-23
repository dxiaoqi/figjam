// Records the Phase 0 demo: a person sketches, Claude Code (over real MCP) synthesizes, the person reviews.
// usage: node scripts/demo.mjs <out-dir>   (expects `npm run dev` running with an empty board)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { chromium } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.resolve(process.argv[2] ?? 'media')
fs.mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const base = 'http://127.0.0.1:47820'

const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, recordVideo: { dir: out, size: { width: 1440, height: 900 } } })
const page = await context.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
const shot = async (name) => {
  await page.screenshot({ path: path.join(out, name) })
  console.log(`✓ ${name}`)
}

await page.goto(base)
await sleep(2500)
await shot('01-empty-board.png')

// a person seeds the board
await page.mouse.dblclick(250, 260)
await sleep(250)
await page.keyboard.type('8 interviews: 5 designers, 3 PMs', { delay: 18 })
await page.keyboard.press('Tab')
await sleep(250)
await page.keyboard.type('Goal: a first run that feels magical', { delay: 18 })
await page.keyboard.press('Escape')
await page.mouse.click(900, 820)
await sleep(500)
// step back to make room, like a person would before asking an agent for help
await page.evaluate(() => {
  const b = window.editor.getCurrentPageBounds()
  window.editor.zoomToBounds({ x: b.x - 80, y: b.y - 150, w: 2100, h: 1300 }, { animation: { duration: 400 } })
})
await sleep(900)

// Claude Code connects over MCP
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'bin/aifig.mjs'), 'mcp'], env: process.env, stderr: 'inherit' })
const mcp = new Client({ name: 'claude-code', version: '1.0.0' })
await mcp.connect(transport)
const call = async (name, args = {}) => {
  const r = await mcp.callTool({ name, arguments: args })
  const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
  if (r.isError) throw new Error(`${name}: ${text}`)
  return { content: r.content, json: (() => { try { return JSON.parse(text) } catch { return null } })() }
}

await call('set_status', { status: 'Reading the board…' })
await call('get_board')
await sleep(2800)
await call('begin_change_set', { intent: 'Synthesize the 8 onboarding interviews' })
const synth = await call('create_blocks', {
  frame: 'Interview synthesis',
  layout: 'cluster',
  blocks: [
    { text: 'Setup took 40 minutes before the first idea', group: 'Pain points', color: 'red' },
    { text: 'Blank canvas is intimidating', group: 'Pain points', color: 'red' },
    { text: 'AI output needs manual cleanup', group: 'Pain points', color: 'red' },
    { text: 'Keyboard shortcuts feel instant', group: 'Delights', color: 'green' },
    { text: 'Stickies look good without effort', group: 'Delights', color: 'green' },
    { text: 'Seeing the agent work builds trust', group: 'Delights', color: 'green' },
    { text: 'Import from FigJam', group: 'Requests', color: 'blue' },
    { text: 'Templates for research', group: 'Requests', color: 'blue' },
    { text: 'Undo everything the agent did', group: 'Requests', color: 'blue' },
  ],
})
await sleep(1500)
await shot('02-agent-writing-live.png')
await call('set_status', { status: 'Drafting opportunities…' })
await sleep(700)
const opps = await call('create_blocks', {
  frame: 'Opportunities',
  right_of: synth.json.frame,
  layout: 'stack',
  blocks: [
    { kind: 'card', title: 'Start from a question', text: 'Open on a prompt instead of an empty canvas; the agent drafts the first board.', color: 'purple' },
    { kind: 'card', title: 'Tidy by default', text: 'Every write goes through tokens and layout intents — no cleanup pass.', color: 'teal' },
    { kind: 'card', title: 'Review, don’t redo', text: 'Change sets make agent edits reversible in one keystroke.', color: 'blue' },
  ],
})
await sleep(900)
const s = synth.json.created.filter((c) => c.kind === 'sticky')
const o = opps.json.created.filter((c) => c.kind === 'card')
await call('connect', {
  connectors: [
    { from: s[1].id, to: o[0].id },
    { from: s[2].id, to: o[1].id },
    { from: s[8].id, to: o[2].id },
  ],
})
await sleep(1100)
await shot('03-change-set-review.png')
await call('commit_change_set')
const lint = await call('lint_layout')
console.log(`  lint: ${lint.json.summary}`)
const snap = await call('render_snapshot', {})
const img = snap.content.find((c) => c.type === 'image')
fs.writeFileSync(path.join(out, '05-core-snapshot.png'), Buffer.from(img.data, 'base64'))
console.log('✓ 05-core-snapshot.png (rendered by the core for the agent)')
await mcp.close()

// the person reviews and accepts
await sleep(1200)
await page.getByRole('button', { name: /^Accept/ }).first().click()
await sleep(1200)
await page.getByRole('button', { name: 'Toggle theme' }).click()
await sleep(1000)
await shot('04-accepted-dark.png')
await sleep(600)

const video = await page.video().path()
await context.close()
await browser.close()
fs.renameSync(video, path.join(out, 'phase0-demo.webm'))
console.log('✓ phase0-demo.webm')
