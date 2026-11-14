import fs from 'node:fs'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { nodboardHome } from './board'

/**
 * MCP servers the person configured for skills (L1 tools), in ~/.nodboard/mcp.json — the same shape Claude
 * Desktop / Cursor use: { "mcpServers": { "web": { "command": "…", "args": [], "env": {} } } }.
 * A skill calls `<server>.<tool>`; servers start on first use and stay up.
 */
interface ServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

export const mcpConfigPath = () => path.join(nodboardHome(), 'mcp.json')

export function configuredServers(): Record<string, ServerConfig> {
  try {
    const raw = JSON.parse(fs.readFileSync(mcpConfigPath(), 'utf8'))
    return raw && typeof raw.mcpServers === 'object' ? raw.mcpServers : {}
  } catch {
    return {}
  }
}

export class McpTools {
  private clients = new Map<string, Promise<Client>>()

  private connect(name: string) {
    let c = this.clients.get(name)
    if (!c) {
      const cfg = configuredServers()[name]
      if (!cfg) throw new Error(`No MCP server "${name}" configured — add it to ${mcpConfigPath()}`)
      c = (async () => {
        const client = new Client({ name: 'nodboard-skills', version: '0.1.0' })
        await client.connect(new StdioClientTransport({ command: cfg.command, args: cfg.args ?? [], env: { ...(process.env as Record<string, string>), ...(cfg.env ?? {}) }, stderr: 'ignore' }))
        return client
      })()
      c.catch(() => this.clients.delete(name))
      this.clients.set(name, c)
    }
    return c
  }

  /** Is `<server>.<tool>` available (server configured)? Does not start the server. */
  available(tool: string) {
    const [server] = tool.split('.', 1)
    return !!configuredServers()[server]
  }

  /** Call `<server>.<tool>` and return its text content. */
  async call(tool: string, args: Record<string, unknown>, timeoutMs = 20_000): Promise<{ text: string; isError: boolean }> {
    const dot = tool.indexOf('.')
    const server = tool.slice(0, dot)
    const name = tool.slice(dot + 1)
    const client = await this.connect(server)
    const res = (await Promise.race([
      client.callTool({ name, arguments: args }),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${tool} timed out after ${timeoutMs / 1000}s`)), timeoutMs)),
    ])) as { content?: { type: string; text?: string }[]; isError?: boolean }
    const text = (res.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n')
    return { text, isError: !!res.isError }
  }

  close() {
    for (const c of this.clients.values()) c.then((x) => x.close()).catch(() => {})
    this.clients.clear()
  }
}
