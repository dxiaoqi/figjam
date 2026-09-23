import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { callCore, leave } from '../client/core-client'
import { tokenManifest } from '../shared/tokens'
import { toolDefs, type CallerInfo, type ToolName } from '../shared/tools'

const INSTRUCTIONS = `ai-figma is a local infinite canvas shared by the user and you. Everything you write appears live in the
user's canvas app with your cursor, grouped into a change set they can accept or reject.

Best practices:
1. Call get_board first to see frames, blocks and ids.
2. Describe structure, not coordinates: use create_blocks with a layout intent (grid / row / stack / cluster / tree),
   and \`frame\` to put a titled section around related content, or \`inside\` to add to an existing frame.
3. Only use design tokens for color and size (get_design_tokens). Use color to encode meaning, max 4 per frame.
4. Keep stickies short (under ~12 words); use cards (title + body) for anything longer.
5. For one logical task, wrap your edits in begin_change_set / commit_change_set with a clear intent.
6. Before finishing, run lint_layout (and render_snapshot if you can see images); call tidy if there are issues.
7. Never delete or rewrite the user's content unless asked.`

export async function runMcpServer() {
  const server = new McpServer({ name: 'ai-figma', version: '0.1.0' }, { instructions: INSTRUCTIONS })

  const caller = (): CallerInfo => {
    const client = server.server.getClientVersion()?.name ?? 'mcp'
    return {
      id: `${client}:${process.pid}`,
      name: process.env.AIFIG_AGENT_NAME ?? '',
      client,
      kind: 'agent',
    }
  }

  for (const [name, def] of Object.entries(toolDefs)) {
    server.registerTool(
      name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.input as any,
        annotations: {
          readOnlyHint: ['list_boards', 'get_board', 'lint_layout', 'render_snapshot', 'list_change_sets', 'get_design_tokens'].includes(name),
        },
      },
      async (args: any) => {
        try {
          const r = await callCore(name as ToolName, args ?? {}, caller())
          if (!r.ok) return { isError: true, content: [{ type: 'text' as const, text: r.error }] }
          const result = r.result as any
          const content: any[] = []
          if (r.image) content.push({ type: 'image', data: r.image.data, mimeType: r.image.mimeType })
          if (result && typeof result.markdown === 'string') content.push({ type: 'text', text: result.markdown })
          else content.push({ type: 'text', text: JSON.stringify(result, null, 2) })
          return { content }
        } catch (e) {
          return { isError: true, content: [{ type: 'text' as const, text: (e as Error).message }] }
        }
      },
    )
  }

  server.registerResource(
    'design-tokens',
    'aifig://design/tokens',
    { title: 'Design tokens', description: 'Colors, sizes and spacing blocks may use', mimeType: 'application/json' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(tokenManifest(), null, 2) }] }),
  )

  server.registerPrompt(
    'layout-best-practices',
    { title: 'Canvas layout best practices', description: 'How to produce tidy, reviewable boards with ai-figma' },
    async () => ({ messages: [{ role: 'user', content: { type: 'text', text: INSTRUCTIONS } }] }),
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)

  const bye = async () => {
    await leave(caller().id)
    process.exit(0)
  }
  process.stdin.on('close', bye)
  process.on('SIGINT', bye)
  process.on('SIGTERM', bye)
}
