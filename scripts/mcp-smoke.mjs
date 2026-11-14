// Drives the canvas through the real MCP server over stdio, like Claude Code or Cursor would.
// usage: node scripts/mcp-smoke.mjs [--client=claude-code] [--quiet]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const clientName = process.argv.find((a) => a.startsWith('--client='))?.split('=')[1] ?? 'claude-code'
const quiet = process.argv.includes('--quiet')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'bin/nodboard.mjs'), 'mcp'], env: process.env, stderr: 'inherit' })
const client = new Client({ name: clientName, version: '1.0.0' })
await client.connect(transport)

const { tools } = await client.listTools()
console.log(`✓ ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`)

async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args })
  const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
  if (r.isError) throw new Error(`${name}: ${text}`)
  if (!quiet) console.log(`\n→ ${name}\n${text.slice(0, 600)}`)
  return { text, content: r.content, json: (() => { try { return JSON.parse(text) } catch { return null } })() }
}

await call('get_board')
await call('set_status', { status: 'Planning the onboarding flow…' })
await sleep(800)
await call('begin_change_set', { intent: 'Sketch the first-run experience' })
const tree = await call('create_blocks', {
  frame: 'First-run flow',
  layout: 'tree',
  blocks: [
    { ref: 'open', kind: 'card', title: 'Open the app', text: 'Empty board with a single calm prompt.', color: 'gray' },
    { ref: 'manual', parent: 'open', kind: 'card', title: 'Sketch by hand', text: 'S for sticky, C for card — snaps to the grid.', color: 'yellow' },
    { ref: 'agent', parent: 'open', kind: 'card', title: 'Connect an agent', text: 'Copy one line into Claude Code or Cursor.', color: 'purple' },
    { parent: 'agent', kind: 'card', title: 'Agent drafts a board', text: 'Tidy by default, with a visible cursor.', color: 'purple' },
    { parent: 'agent', kind: 'card', title: 'Review the change set', text: 'Accept or reject in one keystroke.', color: 'green' },
  ],
})
await sleep(600)
const ids = tree.json.created.filter((c) => c.kind === 'card').map((c) => c.id)
await call('connect', { connectors: [{ from: ids[1], to: ids[4], label: 'later' }] })
await call('commit_change_set')
const lint = await call('lint_layout')
const snap = await call('render_snapshot', { frame: tree.json.frame })
const img = snap.content.find((c) => c.type === 'image')
if (img) {
  const out = process.env.SNAPSHOT_OUT ?? '/tmp/mcp-snapshot.png'
  fs.writeFileSync(out, Buffer.from(img.data, 'base64'))
  console.log(`\n✓ snapshot image (${img.mimeType}) → ${out}`)
}
console.log(`\n✓ lint ok: ${lint.json?.ok}`)
await client.close()
