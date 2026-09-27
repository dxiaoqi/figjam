// Onboarding and i18n checks: languages (OS locale, Settings switch, CJK typography, long strings), the welcome
// flow, empty-board guidance, templates (UI, CLI, MCP) and one-click agent setup.
// usage: node scripts/onboarding-e2e.mjs [media-dir]
//   Builds the canvas and runs its own core on a spare port with a temporary AIFIG_HOME and a fake home folder
//   for agent configs, so real ~/.cursor / ~/.claude.json files are never touched. With a media dir it also saves
//   screenshots in both languages and a short clip.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { chromium } from 'playwright-core'
import { authHeaders, tokenFor } from './lib/core-auth.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mediaDir = process.argv[2] ? path.resolve(process.argv[2]) : null
if (mediaDir) fs.mkdirSync(mediaDir, { recursive: true })
execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'ignore' })

const port = 48010 + Math.floor(Math.random() * 40) * 2
const base = `http://127.0.0.1:${port}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aifig-onboarding-'))
const agentHome = path.join(tmp, 'user')
fs.mkdirSync(path.join(agentHome, '.cursor'), { recursive: true })
const cursorFile = path.join(agentHome, '.cursor', 'mcp.json')
fs.writeFileSync(cursorFile, JSON.stringify({ mcpServers: { other: { command: 'other-server' } }, keep: true }, null, 4))
const env = { ...process.env, AIFIG_HOME: path.join(tmp, 'aifig'), AIFIG_CORE_PORT: String(port), AIFIG_AGENT_CONFIG_HOME: agentHome, AIFIG_AGENT_PATH: '' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const core = spawn(process.execPath, [path.join(root, 'bin/aifig.mjs'), 'core', '--port', String(port)], { env, stdio: 'ignore' })
for (let i = 0; i < 100 && !(await fetch(`${base}/api/health`).then((r) => r.ok, () => false)); i++) await sleep(100)

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const HUMAN = { id: 'human:onboarding', name: 'You', client: 'test', kind: 'human' }
const call = async (tool, args = {}) => (await fetch(`${base}/api/call`, { method: 'POST', headers: authHeaders(env.AIFIG_HOME), body: JSON.stringify({ tool, args, caller: HUMAN }) })).json()
const cli = (...args) => JSON.parse(execFileSync(process.execPath, [path.join(root, 'bin/aifig.mjs'), '--json', ...args], { env, encoding: 'utf8' }))

// ---- templates: API, CLI, MCP ----------------------------------------------------------
const list = (await call('list_templates')).result.templates
check('list_templates offers the five templates', ['research-synthesis', 'competitor-analysis', 'user-journey', 'brainstorm', 'meeting-notes'].every((id) => list.some((t) => t.id === id)), list.map((t) => t.id).join(', '))
const lintResults = []
for (const t of list) {
  for (const language of ['en', 'zh-CN']) {
    const r = await call('create_board', { template: t.id, language })
    const lint = r.ok ? (await call('lint_layout', { board: r.result.board.id })).result : null
    let typed = 0
    for (const type of ['insight', 'question', 'quote', 'hypothesis', 'idea', 'todo']) typed += r.ok ? ((await call('query_blocks', { board: r.result.board.id, type })).result.blocks?.length ?? 0) : 0
    lintResults.push({ id: t.id, language, ok: r.ok && lint?.issues.length === 0 && r.result.board.blockCount >= 8 && typed > 0, title: r.result?.board.title, blocks: r.result?.board.blockCount, typed, issues: lint?.issues.length })
  }
}
const bad = lintResults.filter((x) => !x.ok)
check('every template builds in both languages with typed blocks and a clean lint', !bad.length, bad.length ? JSON.stringify(bad) : `${lintResults.length} boards`)
check('template boards take the localized template name', lintResults.find((x) => x.id === 'user-journey' && x.language === 'zh-CN')?.title === '用户旅程图' && lintResults.find((x) => x.id === 'brainstorm' && x.language === 'en')?.title === 'Brainstorm')
const viaCli = cli('new-board', 'Retro notes', '--template', 'meeting-notes', '--lang', 'zh-CN')
check('CLI: aifig new-board --template … --lang zh-CN', viaCli.board.title === 'Retro notes' && viaCli.board.blockCount > 10 && viaCli.template === 'meeting-notes', `${viaCli.board.blockCount} blocks`)
const mcp = new Client({ name: 'onboarding-check', version: '1' })
await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'bin/aifig.mjs'), 'mcp'], env }))
const mcpTools = (await mcp.listTools()).tools
const createTool = mcpTools.find((t) => t.name === 'create_board')
const viaMcp = JSON.parse((await mcp.callTool({ name: 'create_board', arguments: { template: 'research-synthesis' } })).content[0].text)
const pendingAfterMcp = (await call('list_change_sets', { board: viaMcp.board.id })).result
await mcp.close()
check('MCP: create_board accepts template + language and applies it directly (no review)', !!createTool?.inputSchema.properties.template && viaMcp.board.blockCount > 10 && !(pendingAfterMcp.changeSets ?? []).some((c) => c.status === 'pending'), `${viaMcp.board.blockCount} blocks`)
const noTpl = await call('create_board', { template: 'nope' })
check('unknown templates are refused with the valid ids', !noTpl.ok && /research-synthesis/.test(noTpl.error))

// ---- agent setup API ----------------------------------------------------------------------
const agentsApi = (p, init = {}) => fetch(`${base}/api/agents${p}`, { ...init, headers: { ...authHeaders(env.AIFIG_HOME), ...init.headers } }).then((r) => r.json().then((j) => ({ status: r.status, ...j })))
const post = (p, headers = {}) => agentsApi(p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' })
const detected = await agentsApi('')
const cur = detected.agents.find((a) => a.id === 'cursor')
const cla = detected.agents.find((a) => a.id === 'claude')
check('detects installed agents (Cursor here, no Claude Code)', cur.installed && cur.state === 'missing' && !cla.installed, JSON.stringify(detected.agents.map((a) => [a.id, a.installed, a.state])))
const evil = await post('/cursor/install', { origin: 'https://evil.example' })
check('agent setup refuses other sites', evil.status === 403 && !JSON.parse(fs.readFileSync(cursorFile, 'utf8')).mcpServers['ai-figma'])
const anon = (p, init = {}) => fetch(`${base}/api/agents${p}`, init).then((r) => r.status)
const noToken = [await anon(''), await anon('/cursor/install', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), await anon('/cursor/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })]
const wrongToken = await anon('/cursor/install', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer nope' }, body: '{}' })
check('agent setup needs the access token (detect, install, test)', noToken.every((s) => s === 401) && wrongToken === 401 && !JSON.parse(fs.readFileSync(cursorFile, 'utf8')).mcpServers['ai-figma'], `${noToken.join(', ')} · wrong token ${wrongToken}`)

// ---- browser --------------------------------------------------------------------------------
const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--no-sandbox'] })
const errors = []
const open = async (locale, { w = 1440, h = 900, video = false, url = '/' } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, locale })
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('aifig:token', t)
    } catch {
      // opaque-origin frames have no storage
    }
  }, tokenFor(env.AIFIG_HOME))
  const page = await ctx.newPage()
  if (video && mediaDir) page.clip = await startClip(page)
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(`${base}${url}`)
  await page.waitForSelector('.ae-canvas', { timeout: 20000 })
  await page.waitForTimeout(600)
  return { ctx, page }
}
/** Screen recording through a CDP screencast, encoded with the system ffmpeg. */
async function startClip(page) {
  const cdp = await page.context().newCDPSession(page)
  const frames = []
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp })
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1600, maxHeight: 1000, everyNthFrame: 1 })
  return async (out) => {
    await cdp.send('Page.stopScreencast').catch(() => {})
    if (!frames.length) return
    const dir = fs.mkdtempSync(path.join(tmp, 'clip-'))
    const fps = 25
    const t0 = frames[0].t
    const end = frames.at(-1).t + 1
    let j = 0
    for (let i = 0, t = t0; t < end; i++, t = t0 + i / fps) {
      while (j + 1 < frames.length && frames[j + 1].t <= t) j++
      fs.writeFileSync(path.join(dir, `${String(i).padStart(5, '0')}.jpg`), Buffer.from(frames[j].data, 'base64'))
    }
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, '%05d.jpg'), '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out])
  }
}
const shot = async (page, name) => mediaDir && (await page.screenshot({ path: path.join(mediaDir, name) }))
const overflowX = (page, sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].some((el) => el.scrollWidth > el.clientWidth + 1), sel)

// English (OS locale en-US): automation skips the welcome by default
{
  const { ctx, page } = await open('en-US')
  check('automated browsers skip the welcome unless asked', (await page.locator('[data-welcome]').count()) === 0)
  check('English follows the OS locale', (await page.evaluate(() => document.documentElement.lang)) === 'en' && (await page.getByRole('button', { name: 'Sticky note' }).count()) === 1)
  await ctx.close()
}

{
  const { ctx, page } = await open('en-US', { url: '/?welcome=1' })
  await page.waitForTimeout(400)
  await shot(page, 'welcome-1-en.png')
  await page.click('[data-welcome-next]')
  await page.click('[data-welcome-next]')
  await page.waitForSelector('[data-agent-setup="cursor"]')
  await page.waitForTimeout(450)
  await shot(page, 'welcome-3-en.png')
  await ctx.close()
}

// Chinese OS locale: welcome flow, CJK typography, Settings switch
{
  const { ctx, page } = await open('zh-CN', { url: '/?welcome=1', video: true, w: 1280, h: 800 })
  check('Chinese follows the OS locale', (await page.evaluate(() => document.documentElement.lang)) === 'zh-CN' && (await page.getByRole('button', { name: '便签' }).count()) === 1)
  const typo = await page.evaluate(() => {
    const s = getComputedStyle(document.body)
    const h = getComputedStyle(document.querySelector('[data-welcome] h2'))
    return { lh: parseFloat(s.lineHeight) / parseFloat(s.fontSize), font: s.fontFamily, tracking: h.letterSpacing }
  })
  check('CJK typography: CJK fonts in the stack, taller line-height, no negative tracking', /PingFang SC/.test(typo.font) && /Noto Sans CJK SC/.test(typo.font) && typo.lh >= 1.55 && (typo.tracking === 'normal' || parseFloat(typo.tracking) >= 0), JSON.stringify(typo))
  check('welcome shows on first run (step 1)', (await page.locator('[data-welcome-step="1"]').count()) === 1)
  await shot(page, 'welcome-1-zh.png')
  await page.click('[data-welcome-next]')
  await page.waitForTimeout(450)
  const tryBox = await page.locator('[data-welcome-try]').boundingBox()
  await page.mouse.dblclick(tryBox.x + 120, tryBox.y + 90)
  await page.waitForTimeout(700)
  await page.keyboard.type('先写一个想法', { delay: 60 })
  await page.keyboard.press('Tab')
  await page.keyboard.type('再来一个', { delay: 60 })
  await page.waitForTimeout(600)
  await page.waitForTimeout(200)
  check('welcome step 2: double-click writes a sticky, Tab starts the next', (await page.locator('[data-welcome-note]').count()) === 2 && ((await page.locator('[data-welcome-note]').first().textContent()) ?? '').includes('先写一个想法'))
  await shot(page, 'welcome-2-zh.png')
  await page.click('[data-welcome-next]')
  await page.waitForSelector('[data-agent-setup="cursor"]')
  await page.waitForTimeout(450)
  await shot(page, 'welcome-3-zh.png')
  check('welcome step 3 lists detected agents', (await page.locator('[data-agent-setup]').count()) === 2)
  await page.waitForTimeout(900)
  await page.click('[data-welcome-skip]')
  await page.waitForTimeout(600)
  if (page.clip) await page.clip(path.join(mediaDir, 'welcome-flow-zh.mp4'))
  check('the welcome is skippable and remembered', (await page.locator('[data-welcome]').count()) === 0 && !!(await page.evaluate(() => localStorage.getItem('aifig:welcomed'))))

  // settings: switch to English live, persisted
  await page.click('[data-open-settings]')
  await page.waitForSelector('[data-settings-dialog]')
  await page.waitForTimeout(400)
  await shot(page, 'settings-zh.png')
  await page.locator('[data-setting="language"] [data-option="en"]').click()
  await page.waitForTimeout(200)
  const liveEn = (await page.locator('[aria-label="Sticky note"]').count()) === 1 && (await page.locator('[data-settings-dialog]').textContent()).includes('Language')
  await page.keyboard.press('Escape')
  await page.goto(base)
  await page.waitForSelector('.ae-canvas')
  await page.waitForTimeout(500)
  const persisted = (await page.evaluate(() => [document.documentElement.lang, localStorage.getItem('aifig:locale')])).join()
  check('Settings switches the language live and remembers it', liveEn && persisted === 'en,en', `${liveEn} ${persisted}`)
  await page.click('[data-open-settings]')
  await page.locator('[data-setting="language"] [data-option="system"]').click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  check('“Match system” goes back to the OS language', (await page.evaluate(() => document.documentElement.lang)) === 'zh-CN' && (await page.evaluate(() => localStorage.getItem('aifig:locale'))) === null)
  await ctx.close()
}

// Empty board guidance and the new-board dialog, in both languages
for (const [locale, sfx] of [['en-US', 'en'], ['zh-CN', 'zh']]) {
  const blank = (await call('create_board', { title: locale === 'en-US' ? 'Untitled board' : '未命名画板' })).result.board.id
  const { ctx, page } = await open(locale, { url: `/?board=${blank}` })
  check(`[${sfx}] an empty board shows guidance with templates`, (await page.locator('[data-empty-state] [data-template]').count()) === 3)
  await shot(page, `empty-board-${sfx}.png`)
  await page.locator('[data-empty-state] [data-template="brainstorm"]').click()
  await page.waitForSelector('[data-block-id]', { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(900)
  const filled = { n: await page.locator('[data-block-id]').count(), typed: (await call('query_blocks', { board: blank, type: 'idea' })).result.blocks.length }
  const title = (await call('list_boards')).result.boards.find((b) => b.id === blank)?.title
  check(`[${sfx}] a template fills the empty board in place and names it`, filled.n > 10 && filled.typed >= 9 && title === (sfx === 'en' ? 'Brainstorm' : '头脑风暴') && (await page.locator('[data-empty-state]').count()) === 0, `${filled.n} blocks, “${title}”`)
  await shot(page, `template-brainstorm-${sfx}.png`)

  await page.click('button:has(svg.lucide-chevron-down)')
  await page.click('[data-menu-new-board]')
  await page.waitForSelector('[data-new-board-dialog]')
  await page.click('[data-new-board-dialog] [data-template="research-synthesis"]')
  await page.waitForTimeout(150)
  await shot(page, `new-board-dialog-${sfx}.png`)
  check(`[${sfx}] the new-board dialog has no overflowing text`, !(await overflowX(page, '[data-new-board-dialog] [data-template] span, [data-new-board-dialog] button')))
  const before = (await call('list_boards')).result.boards.length
  await page.click('[data-new-board-create]')
  await page.waitForTimeout(1500)
  const boardsNow = (await call('list_boards')).result.boards
  const created = boardsNow.find((b) => b.title === (sfx === 'en' ? 'Research synthesis' : '研究综合') && b.id === new URL(page.url()).searchParams.get('board'))
  check(`[${sfx}] New board ▸ template creates and opens it`, boardsNow.length === before + 1 && !!created && created.blockCount > 10)
  await page.waitForTimeout(400)
  await shot(page, `template-research-${sfx}.png`)
  const relText = await page.locator('.ae-connector-label.is-relation').first().textContent().catch(() => '')
  check(`[${sfx}] connector relation labels are translated`, relText === (sfx === 'en' ? 'supports' : '支持'), relText)
  await ctx.close()
}

// Long strings and small screens: nothing spills out of its box
for (const [locale, sfx] of [['en-US', 'en'], ['zh-CN', 'zh']]) {
  const { ctx, page } = await open(locale, { w: 390, h: 844, url: '/?welcome=1' })
  const spill = await page.evaluate(() => {
    const card = document.querySelector('[data-welcome] > div').getBoundingClientRect()
    return card.right > innerWidth + 0.5 || card.left < -0.5 || [...document.querySelectorAll('[data-welcome] button')].some((b) => b.scrollWidth > b.clientWidth + 1)
  })
  check(`[${sfx}] welcome fits a 390px phone`, !spill)
  if (sfx === 'zh') await shot(page, 'welcome-mobile-zh.png')
  await page.click('[data-welcome-skip]')
  await ctx.close()
  const wide = await open(locale, { w: 1024, h: 720 })
  const chromeSpill = await wide.page.evaluate(() => [...document.querySelectorAll('.chrome button, .chrome span')].some((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow !== 'ellipsis'))
  await wide.page.click('[data-open-settings]')
  await wide.page.waitForSelector('[data-settings-dialog]')
  const settingsSpill = await overflowX(wide.page, '[data-settings-dialog] button')
  check(`[${sfx}] toolbar, top bar and settings fit at 1024px`, !chromeSpill && !settingsSpill)
  await wide.ctx.close()
}

// One-click agent setup from Connect agent (confirm → backup → idempotent → test connection), with a clip
{
  const enBoard = (await call('create_board', { template: 'research-synthesis', language: 'en' })).result.board.id
  const { ctx, page } = await open('en-US', { video: true, w: 1280, h: 800, url: `/?board=${enBoard}` })
  await page.getByRole('button', { name: 'Connect agent' }).click()
  await page.waitForSelector('[data-agent-setup="cursor"][data-agent-state="missing"]')
  await shot(page, 'connect-agent-en.png')
  check('Connect agent shows one-click setup and keeps the manual configs', (await page.locator('[data-connect-dialog] pre').count()) >= 1 && (await page.locator('[data-agent-setup="claude"] [data-agent-install]').count()) === 0)
  await page.click('[data-agent-setup="cursor"] [data-agent-install]')
  await page.waitForSelector('[data-agent-confirm]')
  check('setup asks for confirmation before writing', !JSON.parse(fs.readFileSync(cursorFile, 'utf8')).mcpServers['ai-figma'] && ((await page.locator('[data-agent-confirm]').textContent()) ?? '').includes('.cursor/mcp.json'))
  await page.waitForTimeout(700)
  await page.click('[data-agent-confirm-write]')
  await page.waitForSelector('[data-agent-setup="cursor"][data-agent-state="configured"]')
  const written = JSON.parse(fs.readFileSync(cursorFile, 'utf8'))
  const backups = fs.readdirSync(path.dirname(cursorFile)).filter((f) => f.startsWith('mcp.json.aifig-backup-'))
  const backupData = backups[0] ? JSON.parse(fs.readFileSync(path.join(path.dirname(cursorFile), backups[0]), 'utf8')) : null
  check('writes the ai-figma entry and keeps everything else', written.mcpServers['ai-figma']?.args?.includes('mcp') && written.mcpServers.other?.command === 'other-server' && written.keep === true && /\n {4}"mcpServers"/.test(fs.readFileSync(cursorFile, 'utf8')))
  check('backs up the previous file first', backups.length === 1 && !backupData?.mcpServers['ai-figma'] && backupData?.keep === true, backups.join(', '))
  const again = await post('/cursor/install')
  check('writes are idempotent (no change, no new backup)', again.changed === false && fs.readdirSync(path.dirname(cursorFile)).filter((f) => f.startsWith('mcp.json.aifig-backup-')).length === 1)
  await page.waitForTimeout(600)
  await page.click('[data-agent-setup="cursor"] [data-agent-test]')
  await page.waitForFunction(() => /tools|工具/.test(document.querySelector('[data-agent-setup="cursor"] [data-agent-result]')?.textContent ?? '') || document.querySelector('[data-agent-result="error"]'), null, { timeout: 25000 })
  const testText = (await page.locator('[data-agent-setup="cursor"] [data-agent-result]').textContent()) ?? ''
  check('“Test connection” launches the configured server and lists its tools', (await page.locator('[data-agent-result="ok"]').count()) === 1 && /\d+ tools/.test(testText), testText)
  await page.waitForTimeout(1200)
  await shot(page, 'connect-agent-done-en.png')
  check('Connect agent never scrolls sideways (long config paths truncate)', await page.locator('[data-connect-dialog]').evaluate((el) => el.scrollLeft === 0 && el.scrollWidth <= el.clientWidth + 1))
  if (page.clip) await page.clip(path.join(mediaDir, 'agent-setup-en.mp4'))
  await ctx.close()
}

// Chinese Connect dialog, dark mode
{
  const zhBoard = (await call('create_board', { template: 'user-journey', language: 'zh-CN' })).result.board.id
  const { ctx, page } = await open('zh-CN', { url: `/?board=${zhBoard}` })
  await page.getByRole('button', { name: '切换主题' }).click()
  await page.getByRole('button', { name: '连接 Agent' }).click()
  await page.waitForSelector('[data-agent-setup="cursor"]')
  await page.waitForTimeout(300)
  await shot(page, 'connect-agent-zh-dark.png')
  check('[zh] Connect agent is translated, including agent status', ((await page.locator('[data-connect-dialog]').textContent()) ?? '').includes('一键设置') && ((await page.locator('[data-agent-setup="cursor"]').textContent()) ?? '').includes('已连接'))
  await ctx.close()
}

// security, data safety and skills surfaces in Chinese
{
  const gateCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' })
  const gate = await gateCtx.newPage()
  await gate.goto(base)
  await gate.waitForSelector('[data-token-gate]', { timeout: 15000 }).catch(() => {})
  check('[zh] the sign-in screen is translated', ((await gate.locator('[data-token-gate]').textContent()) ?? '').includes('将此浏览器连接到 ai-figma'))
  await gateCtx.close()
  const zhBoard = (await call('create_board', { title: '版本' })).result.board.id
  await call('create_version', { board: zhBoard, name: '第一版' })
  const { ctx, page } = await open('zh-CN', { url: `/?board=${zhBoard}` })
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('aifig:versions', { detail: {} })))
  await page.waitForSelector('[data-version-history] [data-version]')
  const versionsText = (await page.locator('[data-version-history]').textContent()) ?? ''
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.dispatchEvent(new Event('aifig:skills')))
  await page.waitForSelector('[data-skills-panel]')
  const skillsText = (await page.locator('[data-skills-panel]').textContent()) ?? ''
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.dispatchEvent(new Event('aifig:activity')))
  await page.waitForSelector('[data-activity-dialog]')
  const activityText = (await page.locator('[data-activity-dialog]').textContent()) ?? ''
  check('[zh] version history, skills and activity are translated', versionsText.includes('版本历史') && versionsText.includes('恢复此版本') && skillsText.includes('此画板') && activityText.includes('已记住的权限'), [versionsText, skillsText, activityText].map((s) => s.slice(0, 40)).join(' | '))
  await ctx.close()
}

// switching Cursor to local HTTP from Connect agent: url + Authorization header, private file, HTTP handshake
{
  const httpBoard = (await call('create_board', { title: 'HTTP setup' })).result.board.id
  const { ctx, page } = await open('en-US', { url: `/?board=${httpBoard}` })
  await page.getByRole('button', { name: 'Connect agent' }).click()
  await page.waitForSelector('[data-agent-setup="cursor"][data-agent-state="configured"]')
  await page.click('[data-agent-setup="cursor"] [data-agent-change]')
  await page.click('[data-agent-setup="cursor"] [data-agent-transport="http"]')
  await page.click('[data-agent-confirm-write]')
  await page.waitForFunction(() => /HTTP/.test(document.querySelector('[data-agent-setup="cursor"][data-agent-state="configured"]')?.textContent ?? ''), null, { timeout: 10000 })
  const entry = JSON.parse(fs.readFileSync(cursorFile, 'utf8')).mcpServers['ai-figma']
  const mode = fs.statSync(cursorFile).mode & 0o777
  check('one-click setup can write an HTTP entry with the Authorization header', entry.url === `${base}/mcp` && entry.headers?.Authorization === `Bearer ${tokenFor(env.AIFIG_HOME)}` && !entry.command, JSON.stringify({ ...entry, headers: Object.keys(entry.headers ?? {}) }))
  check('a config holding the token is readable by this user only', process.platform === 'win32' || (mode & 0o077) === 0, mode.toString(8))
  await page.click('[data-agent-setup="cursor"] [data-agent-test]')
  await page.waitForFunction(() => /tools/.test(document.querySelector('[data-agent-setup="cursor"] [data-agent-result]')?.textContent ?? '') || document.querySelector('[data-agent-setup="cursor"] [data-agent-result="error"]'), null, { timeout: 25000 })
  const httpTest = (await page.locator('[data-agent-setup="cursor"] [data-agent-result]').textContent()) ?? ''
  check('“Test connection” does the MCP handshake over HTTP with the configured token', (await page.locator('[data-agent-setup="cursor"] [data-agent-result="ok"]').count()) === 1 && /\d+ tools/.test(httpTest), httpTest)
  await shot(page, 'connect-agent-http-en.png')
  await ctx.close()

  fs.mkdirSync(path.join(agentHome, '.claude'), { recursive: true })
  fs.writeFileSync(path.join(agentHome, '.claude.json'), JSON.stringify({ projects: {}, mcpServers: {} }))
  const cl = await agentsApi('/claude/install', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transport: 'http' }) })
  const clEntry = JSON.parse(fs.readFileSync(path.join(agentHome, '.claude.json'), 'utf8')).mcpServers['ai-figma']
  check('Claude Code gets a type "http" entry', cl.ok && cl.status.transport === 'http' && cl.status.state === 'configured' && clEntry.type === 'http' && clEntry.url === `${base}/mcp` && /^Bearer /.test(clEntry.headers?.Authorization ?? ''))
  const clTest = await agentsApi('/claude/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  check('the Claude Code HTTP entry passes the connection test', clTest.ok === true && clTest.tools > 20, JSON.stringify(clTest))
  const badTransport = await agentsApi('/claude/install', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transport: 'sse' }) })
  check('unknown transports are refused', badTransport.status === 400)
}

// a broken config is reported, not overwritten
{
  fs.writeFileSync(path.join(agentHome, '.claude.json'), '{ not json')
  fs.mkdirSync(path.join(agentHome, '.claude'), { recursive: true })
  const broken = await post('/claude/install')
  check('an unreadable config is left alone', broken.ok === false && fs.readFileSync(path.join(agentHome, '.claude.json'), 'utf8') === '{ not json')
}

check('no console errors', !errors.length, errors.slice(0, 3).join(' | '))
await browser.close()
core.kill()
try {
  fs.rmSync(tmp, { recursive: true, force: true })
} catch {
  /* core may still be writing */
}
console.log(failures ? `\n${failures} onboarding check(s) failed` : '\nall onboarding checks passed')
process.exit(failures ? 1 : 0)
