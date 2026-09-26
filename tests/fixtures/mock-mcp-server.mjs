// A tiny MCP server for tests: `search` returns a bullet list, `fail` always errors.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'mock-web', version: '1.0.0' })
server.registerTool('search', { description: 'Fake web search', inputSchema: { query: z.string() } }, async ({ query }) => ({
  content: [{ type: 'text', text: `- Source A about ${query}\n- Source B: survey of 200 teams\n- Source C: vendor benchmark` }],
}))
server.registerTool('fail', { description: 'Always fails', inputSchema: {} }, async () => ({ isError: true, content: [{ type: 'text', text: 'upstream unavailable' }] }))
await server.connect(new StdioServerTransport())
