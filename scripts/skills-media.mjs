// Media for Skill v1: Skills panel, product-kit and research-kit boards with layouts, permission prompt,
// activity log, Save as block type, and the `aifig skill` CLI.
// usage: node scripts/skills-media.mjs <out-dir>   (expects `npm run dev`)
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { authHeaders, homeOf, signIn } from './lib/core-auth.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.resolve(process.argv[2] ?? 'skills-media')
fs.mkdirSync(out, { recursive: true })
const base = 'http://127.0.0.1:47820'
const bin = path.join(root, 'bin/aifig.mjs')
const cli = (...args) => execFileSync(process.execPath, [bin, ...args], { encoding: 'utf8' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const board = JSON.parse(cli('--json', 'new-board', 'Whiteboard market — competitors')).board.id
const call = (who, tool, args) => JSON.parse(cli('--json', '--board', board, ...who, 'call', tool, JSON.stringify({ board, ...args })))
cli('--board', board, '--human', 'skill', 'enable', 'product-kit')
cli('--board', board, '--human', 'skill', 'enable', 'research-kit')
cli('--human', 'call', 'load_dev_skill', JSON.stringify({ path: path.join(root, 'tests/fixtures/skills/probe-kit') }))
await fetch('http://127.0.0.1:47821/api/permissions/revoke', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ subject: 'skill:probe-kit' }) })

// an agent (Claude Code) fills the board using the skill's types
const comp = (title, text, segment, positioning, price, url) => ({ title, text, type: 'product-kit.competitor', fields: { segment, positioning, price, url } })
call(['--as', 'Claude Code'], 'create_blocks', {
  frame: 'Competitors',
  at: { x: 0, y: 0 },
  layout: 'grid',
  columns: 3,
  blocks: [
    comp('FigJam', 'Online whiteboard from Figma.', 'Design teams', 'mainstream', 5, 'https://www.figma.com/figjam/'),
    comp('Miro', 'The visual workspace for innovation.', 'Enterprise', 'premium', 10, 'https://miro.com'),
    comp('Excalidraw', 'Virtual whiteboard for sketching hand-drawn like diagrams.', 'Developers', 'budget', 0, 'https://excalidraw.com'),
    comp('tldraw', 'An infinite canvas SDK for developers.', 'Developers', 'mainstream', 0, 'https://tldraw.com'),
    comp('Heptabase', 'A visual note-taking tool for learning and research.', 'Researchers', 'premium', 12, 'https://heptabase.com'),
    comp('ai-figma', 'A local canvas your agents can use well.', 'Design teams', 'budget', 0, 'https://example.com'),
  ],
})
call(['--as', 'Claude Code'], 'create_blocks', {
  frame: 'Launches',
  at: { x: 0, y: 1100 },
  blocks: [
    { text: 'Miro AI', type: 'product-kit.launch', fields: { date: '2023-04', competitor: 'Miro' } },
    { text: 'FigJam AI', type: 'product-kit.launch', fields: { date: '2023-11', competitor: 'FigJam' } },
    { text: 'tldraw SDK 2.0', type: 'product-kit.launch', fields: { date: '2024-05', competitor: 'tldraw' } },
    { text: 'Excalidraw+ collab', type: 'product-kit.launch', fields: { date: '2022-09', competitor: 'Excalidraw' } },
    { text: 'Heptabase 1.0', type: 'product-kit.launch', fields: { date: '2023-07', competitor: 'Heptabase' } },
  ],
})
cli('--board', board, '--human', 'accept')

const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, recordVideo: { dir: out, size: { width: 1440, height: 900 } } })
const page = await context.newPage()
await signIn(page)
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
const ed = (fn, arg) => page.evaluate(fn, arg)
const shot = async (name) => {
  await page.screenshot({ path: path.join(out, name) })
  console.log(`· ${name}`)
}
const fitFrame = async (title, pad = 80) => {
  await ed(([t, pad]) => { const f = window.editor.blocks().find((b) => b.title === t); const r = window.editor.pageRect(f.id); window.editor.zoomToBounds({ x: r.x - pad, y: r.y - pad - 40, w: r.w + pad * 2, h: r.h + pad * 2 + 60 }, { animate: false, maxZoom: 1.1 }) }, [title, pad])
  await sleep(700)
}
await page.goto(`${base}/?board=${board}`)
await sleep(2500)

// 1. Skills panel
await page.locator('[data-skills-button]').click()
await sleep(500)
await page.getByRole('tab', { name: 'Library' }).click()
await sleep(600)
await page.locator('[data-skill-card="product-kit"] button', { hasText: 'Instructions for agents' }).first().click()
await sleep(900)
await shot('01-skills-panel-library.png')
await page.keyboard.press('Escape')
await sleep(400)

// 2. competitor cards with card templates, then the positioning matrix
await fitFrame('Competitors')
await shot('02-competitor-cards-templates.png')
cli('--board', board, '--human', 'call', 'apply_skill_layout', JSON.stringify({ board, layout: 'product-kit.positioning-matrix', frame: 'Competitors' }))
await sleep(900)
await fitFrame('Competitors')
await shot('03-positioning-matrix.png')
cli('--board', board, '--human', 'call', 'apply_skill_layout', JSON.stringify({ board, layout: 'product-kit.launches', frame: 'Launches' }))
await sleep(900)
await fitFrame('Launches')
await shot('04-launch-timeline.png')

// 3. an L1 action asks first, then shows in the activity log
cli('--board', board, '--human', 'skill', 'enable', 'probe-kit')
const probe = call(['--human'], 'create_blocks', { at: { x: 2200, y: 0 }, blocks: [{ title: 'Pricing research', type: 'probe-kit.probe', fields: { level: 2 } }] }).created[0].id
await ed((i) => { const r = window.editor.pageRect(i); window.editor.zoomToBounds({ x: r.x - 500, y: r.y - 300, w: r.w + 1000, h: r.h + 600 }, { animate: false }) }, probe)
await sleep(600)
await ed((i) => window.editor.select([i]), probe)
const pp = await ed((i) => { const r = window.editor.pageRect(i); return window.editor.pageToScreen({ x: r.x + r.w / 2, y: r.y + r.h / 2 }) }, probe)
await page.mouse.click(pp.x, pp.y, { button: 'right' })
await sleep(400)
await page.locator('[data-skill-actions]').click()
await sleep(500)
await shot('05-skill-actions-menu.png')
await page.locator('[data-skill-action="probe-kit.peek"]').click()
await sleep(900)
await shot('06-permission-prompt.png')
await page.locator('[data-permission-always]').click()
await sleep(1000)
await page.locator('[data-skills-button]').click()
await sleep(400)
await page.getByRole('tab', { name: 'Activity' }).click()
await sleep(1200)
await shot('07-activity-log.png')
await page.keyboard.press('Escape')
await sleep(300)

// 4. no-code: Save as block type
const card = call(['--human'], 'create_blocks', { at: { x: 2200, y: 500 }, blocks: [{ kind: 'card', title: 'Interview: Maya (PM)', text: 'Role: Product manager\nCompany size: 120\nUses AI daily: yes\nBiggest pain: Handoffs to design' }] }).created[0].id
await ed((i) => { const r = window.editor.pageRect(i); window.editor.zoomToBounds({ x: r.x - 500, y: r.y - 250, w: r.w + 1000, h: r.h + 500 }, { animate: false }) }, card)
await sleep(600)
await ed((i) => window.editor.select([i]), card)
const cp = await ed((i) => { const r = window.editor.pageRect(i); return window.editor.pageToScreen({ x: r.x + r.w / 2, y: r.y + r.h / 2 }) }, card)
await page.mouse.click(cp.x, cp.y, { button: 'right' })
await sleep(300)
await page.locator('[data-set-as]').click()
await sleep(300)
await page.locator('[data-save-type]').click()
await sleep(500)
await page.locator('[data-type-label]').fill('Interviewee')
await page.getByRole('button', { name: 'User', exact: true }).click()
await sleep(300)
await shot('08-save-as-block-type.png')
await page.locator('[data-save-type-submit]').click()
await sleep(1200)
await ed((i) => window.editor.select([]), card)
await sleep(300)
await shot('09-saved-type-on-board.png')
const savedType = await ed((i) => window.editor.block(i).type, card)
const savedSkill = savedType.split('.')[0]

// 5. dark mode overview
await fitFrame('Competitors')
await page.getByRole('button', { name: 'Toggle theme' }).click()
await sleep(900)
await shot('10-competitors-dark.png')
await page.getByRole('button', { name: 'Toggle theme' }).click()
await sleep(400)

const video = await page.video().path()
await context.close()
await browser.close()
fs.renameSync(video, path.join(out, 'skills-v1.webm'))

// the CLI side: new → validate (with a mistake) → install; and the exported skill folder
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-media-'))
const run = (...a) => {
  const r = spawnSync(process.execPath, [bin, ...a], { encoding: 'utf8', cwd: work })
  return `$ aifig ${a.join(' ')}\n${r.stdout}${r.stderr}`
}
const log = [run('skill', 'new', 'persona-kit')]
const bj = path.join(work, 'persona-kit/canvas/blocks.json')
const j = JSON.parse(fs.readFileSync(bj, 'utf8'))
j.types.item.color = 'magenta'
j.types.item.template.rows.push('due')
fs.writeFileSync(bj, JSON.stringify(j, null, 2))
log.push(run('skill', 'validate', 'persona-kit'))
log.push(run('--board', board, 'skill', 'list'))
fs.writeFileSync(path.join(out, 'skill-cli.txt'), log.join('\n'))
const home = homeOf()
const skillDir = path.join(home, 'skills', savedSkill)
fs.writeFileSync(path.join(out, 'saved-type-SKILL.md'), fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'))
fs.writeFileSync(path.join(out, 'saved-type-blocks.json'), fs.readFileSync(path.join(skillDir, 'canvas/blocks.json'), 'utf8'))
fs.writeFileSync(path.join(out, 'export.md'), cli('--board', board, 'export', '--format', 'md'))
fs.rmSync(work, { recursive: true, force: true })
console.log(`board ${board} · saved skill ${savedSkill}`)
