// Media for data safety: version history with a read-only preview, an undoable restore, and the recovery notice.
// usage: node scripts/data-safety-media.mjs <out-dir> seed|shots|recovered   (expects `npm run dev`; honours AIFIG_UI_PORT / AIFIG_HOME)
//   seed       build a board with a history (checkpoint, agent work, a large deletion)
//   shots      version-history.png, restored.png, version-history-dark.png
//   recovered  recovered-notice.png — run after truncating a board file and restarting the core
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.resolve(process.argv[2] ?? 'data-safety')
const phase = process.argv[3] ?? 'shots'
fs.mkdirSync(out, { recursive: true })
const base = `http://127.0.0.1:${process.env.AIFIG_UI_PORT ?? 47820}`
const cli = (...args) => execFileSync(process.execPath, [path.join(root, 'bin/aifig.mjs'), ...args], { encoding: 'utf8' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const TITLE = 'Onboarding research'

if (phase === 'seed') {
  const board = JSON.parse(cli('--json', 'new-board', TITLE)).board.id
  const call = (who, tool, args) => JSON.parse(cli('--json', '--board', board, ...who, 'call', tool, JSON.stringify({ board, ...args })))
  call(['--human'], 'create_blocks', {
    frame: 'Interview notes',
    layout: 'cluster',
    blocks: [
      { text: 'Setup took 40 minutes — gave up twice', group: 'Friction', color: 'red' },
      { text: 'Didn’t know which template to start from', group: 'Friction', color: 'red' },
      { text: 'Invite flow asks for a credit card', group: 'Friction', color: 'red' },
      { text: 'Loved that it works offline on the train', group: 'Delight', color: 'green' },
      { text: 'Agent tidied my messy board in one go', group: 'Delight', color: 'green' },
      { text: 'Keyboard shortcuts feel like Linear', group: 'Delight', color: 'green' },
      { text: 'Wants to import from FigJam', group: 'Requests', color: 'blue' },
      { text: 'Share a read-only link with stakeholders', group: 'Requests', color: 'blue' },
    ],
  })
  cli('--board', board, 'checkpoint', 'Interview notes clustered')
  call(['--as', 'Claude Code'], 'create_blocks', {
    frame: 'Themes',
    layout: 'row',
    intent: 'Summarize the interview clusters into themes',
    blocks: [
      { kind: 'card', title: 'First-run is too long', text: 'Three of six participants stalled before their first board.' },
      { kind: 'card', title: 'Offline is a differentiator', text: 'Mentioned unprompted by P2 and P5.' },
    ],
  })
  cli('--board', board, '--human', 'accept')
  // a large deletion: the state from just before it is kept as a version
  const r = call(['--human'], 'get_board', { format: 'json' })
  const blocks = [...r.blocks, ...r.frames.flatMap((f) => f.children ?? [])].filter((b) => b.kind === 'sticky')
  call(['--human'], 'delete_blocks', { ids: blocks.slice(0, 6).map((b) => b.id) })
  cli('--board', board, 'checkpoint', 'Trimmed to the strongest notes')
  console.log(board)
  process.exit(0)
}

const board = JSON.parse(cli('--json', 'boards')).boards.find((b) => b.title === TITLE)?.id
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/local/bin/google-chrome', args: ['--no-sandbox'] })
const shoot = async (dark, fn) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light' })
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.goto(`${base}/?board=${board}`)
  await page.waitForSelector('.aifig-canvas')
  await sleep(1500)
  await fn(page)
  await page.close()
}
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(out, name) })
  console.log(`· ${name}`)
}
const openHistory = async (page) => {
  await page.getByRole('button', { name: TITLE }).click()
  await page.locator('[data-menu-versions]').click()
  await page.waitForSelector('[data-version-list] [data-version]')
}
const pick = async (page, name) => {
  await page.locator('[data-version]', { hasText: name }).first().click()
  await page.waitForFunction(() => document.querySelector('[data-version-diff]')?.textContent?.includes('Restoring'))
  await page.waitForFunction(() => document.querySelector('[data-version-preview] img')?.classList.contains('opacity-100'))
  await sleep(300)
}

if (phase === 'shots') {
  await shoot(false, async (page) => {
    await openHistory(page)
    await pick(page, 'Interview notes clustered')
    await shot(page, 'version-history.png')
    await page.locator('[data-restore-version]').click()
    await page.waitForSelector('[data-sonner-toast]')
    await sleep(900)
    await page.evaluate(() => window.editor?.zoomToFit(false))
    await sleep(500)
    await shot(page, 'restored.png')
  })
  await shoot(true, async (page) => {
    await openHistory(page)
    await pick(page, 'Before 6 items were removed')
    await shot(page, 'version-history-dark.png')
  })
}

if (phase === 'recovered') {
  await shoot(false, async (page) => {
    await page.waitForSelector('[data-notice="recovered"]')
    await sleep(400)
    await shot(page, 'recovered-notice.png')
  })
}
await browser.close()
