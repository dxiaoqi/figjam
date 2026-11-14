// Data safety end to end, against a real core process: versions over MCP and the CLI, kill -9 of the core
// during agent writes, and startup recovery from a truncated / future-version board file.
// usage: node scripts/data-safety.mjs   (isolated core on a spare port with a temporary NODBOARD_HOME)
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { authHeaders } from './lib/core-auth.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = 48010 + Math.floor(Math.random() * 40) * 2
const base = `http://127.0.0.1:${port}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nodboard-safety-'))
const env = { ...process.env, NODBOARD_HOME: home, NODBOARD_CORE_PORT: String(port) }
const bin = path.join(root, 'bin/nodboard.mjs')
let core
const startCore = async () => {
  core = spawn(process.execPath, [bin, 'core', '--port', String(port)], { env, stdio: 'ignore' })
  for (let i = 0; i < 150; i++) {
    if (await fetch(`${base}/api/health`).then((r) => r.ok, () => false)) return
    await sleep(100)
  }
  throw new Error('core did not start')
}
const stopCore = (signal = 'SIGTERM') => new Promise((r) => (core.exitCode !== null ? r() : (core.once('exit', r), core.kill(signal))))
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const HUMAN = { id: 'human:safety', name: 'You', client: 'test', kind: 'human' }
const AGENT = { id: 'safety-agent:1', name: 'Safety Bot', client: 'safety', kind: 'agent' }
const call = async (caller, tool, args = {}) => (await fetch(`${base}/api/call`, { method: 'POST', headers: authHeaders(home), body: JSON.stringify({ tool, args, caller }) })).json()
const cli = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env })
const boardFile = (id) => path.join(home, 'boards', `${id}.nodboard`)

await startCore()
const board = (await call(HUMAN, 'create_board', { title: 'Safety net' })).result.board.id
await call(HUMAN, 'create_blocks', { board, blocks: [{ text: 'alpha' }, { text: 'beta' }, { text: 'gamma' }] })

// ---- MCP ------------------------------------------------------------------------------------
const mcp = new Client({ name: 'safety', version: '1' })
await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [bin, 'mcp'], env, stderr: 'ignore' }))
const tools = (await mcp.listTools()).tools.map((t) => t.name)
check('MCP exposes list_versions, create_version, restore_version', ['list_versions', 'create_version', 'restore_version'].every((t) => tools.includes(t)))
check('human-only version tools are not exposed to agents', !tools.includes('prepare_restore') && !tools.includes('open_backup_folder'))
const text = async (name, args) => JSON.parse((await mcp.callTool({ name, arguments: args })).content[0].text)
const cp = (await text('create_version', { board, name: 'Three greek letters' })).version
check('MCP create_version makes a named checkpoint', cp.kind === 'checkpoint' && cp.blockCount === 3, JSON.stringify(cp))
await call(HUMAN, 'delete_blocks', { board, ids: (await call(HUMAN, 'get_board', { board, format: 'json' })).result.blocks.slice(0, 2).map((b) => b.id) })
const listed = await text('list_versions', { board })
check('MCP list_versions lists it, newest first', listed.versions.some((v) => v.id === cp.id) && listed.versions[0].createdAt >= listed.versions.at(-1).createdAt)
const rs = await text('restore_version', { board, version: cp.id })
check('MCP restore_version from an agent is a pending change set', !!rs.changeSet && rs.summary.added === 2, JSON.stringify(rs.summary))
await call(HUMAN, 'review_change_set', { board, id: rs.changeSet, action: 'accept' })
check('accepting it brings the blocks back', (await call(HUMAN, 'get_board', { board, format: 'json' })).result.blocks.length === 3)
await mcp.close()

// ---- CLI ------------------------------------------------------------------------------------
const c1 = cli('--board', board, 'checkpoint', 'Before', 'the', 'CLI', 'test')
check('nodboard checkpoint', c1.status === 0 && c1.stdout.includes('“Before the CLI test”'), c1.stdout.trim() || c1.stderr.trim())
const cliId = c1.stdout.match(/checkpoint (v[0-9a-z]+)/)?.[1]
const c2 = cli('--board', board, 'versions')
check('nodboard versions', c2.status === 0 && c2.stdout.includes(cliId) && c2.stdout.includes('checkpoint'), c2.stdout.split('\n')[0])
await call(HUMAN, 'create_blocks', { board, blocks: [{ text: 'delta' }] })
const c3 = cli('--board', board, '--human', 'restore', cliId)
check('nodboard --human restore applies directly and prints how to undo', c3.status === 0 && c3.stdout.includes('1 removed') && c3.stdout.includes('nodboard --human restore v'), c3.stdout.trim())
const c4 = cli('--board', board, 'backups')
check('nodboard backups prints the backup folder', c4.status === 0 && c4.stdout.trim().startsWith(path.join(home, 'backups')), c4.stdout.trim())

// ---- kill -9 during agent writes ---------------------------------------------------------------
let bursting = true
const burst = (async () => {
  let acked = 0
  for (let i = 0; bursting; i++) {
    const r = await call(AGENT, 'create_blocks', { board, blocks: Array.from({ length: 5 }, (_, k) => ({ text: `burst ${i}.${k} `.repeat(40) })) }).catch(() => null)
    if (!r?.ok) break
    acked = i + 1
  }
  return acked
})()
// past the first save deadline (2s), then kill while writes are still coming in
await sleep(2600 + Math.random() * 800)
await stopCore('SIGKILL')
bursting = false
const acked = await burst
await startCore()
const afterKill = await call(HUMAN, 'get_board', { board, format: 'json' })
const bursts = afterKill.ok ? afterKill.result.blocks.filter((b) => b.text.startsWith('burst')).length : -1
check('after kill -9 mid-burst the board loads intact on restart', afterKill.ok && bursts > 0, `${bursts / 5} of ${acked} acknowledged calls on disk (≤2s of edits may be lost to kill -9)`)
const noticesAfterKill = (await call(HUMAN, 'get_notices', {})).result.notices
check('…with no recovery needed (atomic writes never tear)', !noticesAfterKill.some((n) => n.boardId === board), JSON.stringify(noticesAfterKill))

// ---- damaged and future files at startup ---------------------------------------------------------
const damaged = (await call(HUMAN, 'create_board', { title: 'Will be truncated' })).result.board.id
await call(HUMAN, 'create_blocks', { board: damaged, blocks: [{ text: 'precious' }, { text: 'also precious' }] })
await call(HUMAN, 'create_version', { board: damaged, name: 'Safe point' })
const future = (await call(HUMAN, 'create_board', { title: 'From the future' })).result.board.id
await stopCore()
const full = fs.readFileSync(boardFile(damaged))
fs.writeFileSync(boardFile(damaged), full.subarray(0, full.length - 37))
const fut = fs.readFileSync(boardFile(future))
const hlen = fut.readUInt32LE(6)
const header = JSON.parse(fut.subarray(10, 10 + hlen).toString())
const h2 = Buffer.from(JSON.stringify({ ...header, schema: '3.0', app: '9.0.0' }))
const len = Buffer.alloc(4)
len.writeUInt32LE(h2.length)
const futureBytes = Buffer.concat([fut.subarray(0, 6), len, h2, fut.subarray(10 + hlen)])
fs.writeFileSync(boardFile(future), futureBytes)
await startCore()
const rec = await call(HUMAN, 'get_board', { board: damaged, format: 'json' })
check('a truncated board is restored from its last version on startup', rec.ok && rec.result.blocks.length === 2, rec.error)
const notices = (await call(HUMAN, 'get_notices', {})).result.notices
const rn = notices.find((n) => n.boardId === damaged)
check('…and the person is told, with the damaged file kept', rn?.kind === 'recovered' && fs.existsSync(rn.file), rn?.detail)
const fn = notices.find((n) => n.boardId === future)
check('a future-version board is refused with a clear notice', fn?.kind === 'future-version' && fn.detail.includes('9.0.0') && fn.detail.includes('Update nodboard'), fn?.detail)
check('…and its file is left exactly as it was', fs.readFileSync(boardFile(future)).equals(futureBytes))
const dis = await call(HUMAN, 'dismiss_notice', { id: rn.id })
check('notices can be dismissed', dis.result.dismissed && !(await call(HUMAN, 'get_notices', {})).result.notices.some((n) => n.id === rn.id))
const agentNotice = await call(AGENT, 'get_notices', {})
check('notice tools are for people only', !agentNotice.ok)

await stopCore()
fs.rmSync(home, { recursive: true, force: true })
console.log(failures ? `\n${failures} check(s) failed` : '\nall data-safety checks passed')
process.exit(failures ? 1 : 0)
