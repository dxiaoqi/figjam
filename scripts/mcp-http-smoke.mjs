// Drives the canvas through MCP over local HTTP (Streamable HTTP) — no process to launch.
// usage: node scripts/mcp-http-smoke.mjs [url]
import http from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const url = process.argv[2] ?? `http://127.0.0.1:${process.env.AIFIG_CORE_PORT ?? 47821}/mcp`
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const client = new Client({ name: 'cursor-vscode', version: 'http-smoke' })
await client.connect(new StreamableHTTPClientTransport(new URL(url)))
const { tools } = await client.listTools()
check('MCP over HTTP lists tools', tools.length > 15, `${tools.length} tools`)
const board = JSON.parse((await client.callTool({ name: 'create_board', arguments: { title: 'HTTP MCP check' } })).content[0].text).board.id
const res = await client.callTool({ name: 'create_blocks', arguments: { board, blocks: [{ text: 'Written over HTTP' }], intent: 'HTTP transport check' } })
check('tools work over HTTP', !res.isError)
const read = (await client.callTool({ name: 'get_board', arguments: { board } })).content[0].text
check('reads back what it wrote', read.includes('Written over HTTP'))
const md = (await client.callTool({ name: 'export_board', arguments: { board, format: 'markdown' } })).content[0].text
check('export_board returns Markdown', md.startsWith('# HTTP MCP check') && md.includes('- Written over HTTP'))
await client.close()

const rebinding = await new Promise((resolve) => {
  const u = new URL(url)
  const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { host: 'evil.example', 'content-type': 'application/json', accept: 'application/json, text/event-stream' } }, (r) => {
    r.resume()
    resolve({ status: r.statusCode })
  })
  req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }))
})
check('rejects requests for other hosts (DNS rebinding protection)', rebinding.status >= 400, `HTTP ${rebinding.status}`)
await fetch(`${url.replace('/mcp', '')}/api/call`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool: 'delete_board', args: { board }, caller: { id: 't', name: 't', client: 't', kind: 'human' } }) })
console.log(failures ? `\n${failures} failed` : '\nall HTTP MCP checks passed')
process.exit(failures ? 1 : 0)
