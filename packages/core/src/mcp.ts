import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { tokenManifest, toolDefs, type CallResponse, type CallerInfo, type ToolName } from '@aifig/shared'

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
7. Never delete or rewrite the user's content unless asked.\n8. People leave comments on blocks: call get_threads to read them, revise, then reply_thread / resolve_thread.\n9. Skills: call list_skills. Skills enabled on the board add block types (e.g. research.quote — use them in create_blocks), layouts and actions; read get_skill and follow its instructions when working with its blocks.`


const READ_ONLY = ['list_boards', 'get_board', 'lint_layout', 'render_snapshot', 'list_change_sets', 'get_design_tokens', 'get_threads', 'export_board', 'list_types', 'query_blocks', 'list_skills', 'get_skill']

/** The ai-figma MCP server, shared by the stdio transport (CLI) and the core's local HTTP endpoint. */
export function buildMcpServer(invoke: (tool: ToolName, args: Record<string, unknown>, caller: CallerInfo) => Promise<CallResponse>, callerFor: (clientName: string) => CallerInfo) {
  const server = new McpServer({ name: 'ai-figma', version: '0.1.0' }, { instructions: INSTRUCTIONS })
  const caller = () => callerFor(server.server.getClientVersion()?.name ?? 'mcp')
  for (const [name, def] of Object.entries(toolDefs)) {
    server.registerTool(
      name,
      { title: def.title, description: def.description, inputSchema: def.input as any, annotations: { readOnlyHint: READ_ONLY.includes(name) } },
      async (args: any) => {
        try {
          const r = await invoke(name as ToolName, args ?? {}, caller())
          if (!r.ok) return { isError: true, content: [{ type: 'text' as const, text: r.error }] }
          const result = r.result as any
          const content: any[] = []
          if (r.image) content.push({ type: 'image', data: r.image.data, mimeType: r.image.mimeType })
          if (name === 'render_snapshot' && args?.raw && typeof result?.svg === 'string') content.push({ type: 'text', text: result.svg })
          else if (result && typeof result.markdown === 'string') content.push({ type: 'text', text: result.markdown })
          else if (result && typeof result.content === 'string' && name === 'export_board') content.push({ type: 'text', text: result.content })
          else content.push({ type: 'text', text: JSON.stringify(result, null, 2) })
          // text-only results (markdown, raw svg, exports) still surface adjustments
          if (result?.warnings?.length && content.every((c) => c.type !== 'text' || !c.text.startsWith('{'))) content.push({ type: 'text', text: `Warnings:\n- ${result.warnings.join('\n- ')}` })
          return { content }
        } catch (e) {
          return { isError: true, content: [{ type: 'text' as const, text: (e as Error).message }] }
        }
      },
    )
  }
  // every skill's SKILL.md, so agents that browse resources learn them too
  server.registerResource(
    'skill',
    new ResourceTemplate('aifig://skills/{name}/SKILL.md', {
      list: async () => {
        const r = await invoke('list_skills', {}, caller())
        const skills = r.ok ? ((r.result as { skills: { name: string; description: string }[] }).skills ?? []) : []
        return { resources: skills.map((s) => ({ uri: `aifig://skills/${s.name}/SKILL.md`, name: s.name, description: s.description, mimeType: 'text/markdown' })) }
      },
    }),
    { title: 'Skill instructions', description: 'SKILL.md of an ai-figma skill', mimeType: 'text/markdown' },
    async (uri, vars) => {
      const r = await invoke('get_skill', { name: String(vars.name) }, caller())
      const s = r.ok ? (r.result as { name: string; description: string; instructions: string }) : null
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: s ? `# ${s.name}\n\n${s.description}\n\n${s.instructions}` : `No skill ${vars.name}` }] }
    },
  )
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
  return { server, caller }
}
