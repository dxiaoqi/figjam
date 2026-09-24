import fs from 'node:fs'
import { Command } from 'commander'
import { callCore } from './client'
import type { AnyToolName, CallerInfo } from '@aifig/shared'

const program = new Command()
program
  .name('aifig')
  .description('ai-figma — a local canvas for you and your agents')
  .option('--json', 'print raw JSON results')
  .option('--as <name>', 'agent name shown on the canvas (default: env AIFIG_AGENT or "Terminal")')
  .option('--human', 'apply edits directly as the human (no review step)')
  .option('-b, --board <board>', 'board id or title (default: the board open in the canvas app)')

function caller(): CallerInfo {
  const o = program.opts()
  const name = o.as ?? process.env.AIFIG_AGENT ?? 'Terminal'
  if (o.human) return { id: 'human:cli', name: 'You', client: 'cli', kind: 'human' }
  return { id: `cli:${name.toLowerCase().replace(/\s+/g, '-')}`, name, client: /claude|cursor|codex/i.test(name) ? name : 'cli', kind: 'agent' }
}

async function run(tool: AnyToolName, args: Record<string, unknown>, print?: (r: any) => void): Promise<void> {
  const o = program.opts()
  const withBoard = o.board && !('board' in args) && tool !== 'list_boards' && tool !== 'create_board' ? { ...args, board: o.board } : args
  const r = await callCore(tool, withBoard, caller())
  if (!r.ok) {
    console.error(`✗ ${r.error}`)
    process.exit(1)
  }
  if (o.json || !print) console.log(JSON.stringify(r.result, null, 2))
  else print(r.result)
}

function csLine(r: any) {
  return r.changeSet ? `  change set ${r.changeSet} is waiting for review in the canvas` : ''
}

program
  .command('core')
  .description('run the core server in the foreground')
  .option('-p, --port <port>', 'port', (v) => Number(v))
  .action(async (opts) => {
    const { startCore } = await import('@aifig/core')
    const { port } = await startCore(opts.port)
    console.log(`ai-figma core listening on http://127.0.0.1:${port}`)
  })

program
  .command('mcp')
  .description('run the MCP server over stdio (for Claude Code, Cursor, …)')
  .action(async () => {
    const { runMcpServer } = await import('./mcp')
    await runMcpServer()
  })

program
  .command('boards')
  .description('list boards')
  .action(() =>
    run('list_boards', {}, (r) => {
      for (const b of r.boards) console.log(`${b.open ? '●' : ' '} ${b.id}  ${b.title}  (${b.blockCount} blocks${b.pendingChangeSets ? `, ${b.pendingChangeSets} to review` : ''})`)
    }),
  )

program
  .command('new-board <title>')
  .description('create a board')
  .action((title) => run('create_board', { title }, (r) => console.log(`✓ created ${r.board.id} "${r.board.title}"`)))

program
  .command('read')
  .description('print the board outline')
  .option('-f, --frame <frame>', 'only this frame')
  .action((opts) => run('get_board', { frame: opts.frame }, (r) => console.log(r.markdown)))

program
  .command('add [texts...]')
  .description('add blocks, e.g. aifig add "Idea one" "Idea two" --layout row --frame Ideas')
  .option('-k, --kind <kind>', 'sticky | card | text', 'sticky')
  .option('-c, --color <color>', 'color token')
  .option('-s, --size <size>', 's | m | l | xl')
  .option('-l, --layout <layout>', 'grid | row | stack | cluster | tree')
  .option('--columns <n>', 'grid columns', (v) => Number(v))
  .option('--frame <title>', 'wrap in a new frame')
  .option('--inside <frame>', 'add inside an existing frame')
  .option('--right-of <id>', 'place right of a block')
  .option('--below <id>', 'place below a block')
  .option('--at <x,y>', 'explicit top-left position')
  .option('-t, --type <type>', 'block type: insight | question | quote | hypothesis | idea | todo')
  .option('--from-json <file>', 'read a full create_blocks payload from a JSON file ("-" for stdin)')
  .option('-i, --intent <text>', 'why (shown to the reviewer)')
  .action((texts: string[], o) => {
    let args: Record<string, unknown>
    if (o.fromJson) {
      args = JSON.parse(fs.readFileSync(o.fromJson === '-' ? 0 : o.fromJson, 'utf8'))
    } else {
      if (!texts.length) {
        console.error('✗ nothing to add — pass some text, or --from-json')
        process.exit(1)
      }
      const blocks = texts.map((t) => {
        if (o.kind === 'card') {
          const [title, ...rest] = t.split('::')
          return { kind: 'card', title: title.trim(), text: rest.join('::').trim(), color: o.color, size: o.size, type: o.type }
        }
        return { kind: o.kind, text: t, color: o.color, size: o.size, type: o.type }
      })
      const at = o.at ? (([x, y]) => ({ x, y }))(String(o.at).split(',').map(Number)) : undefined
      args = { blocks, layout: o.layout, columns: o.columns, frame: o.frame, inside: o.inside, right_of: o.rightOf, below: o.below, at, intent: o.intent }
    }
    return run('create_blocks', args, (r) => {
      console.log(`✓ added ${r.created.length} block${r.created.length === 1 ? '' : 's'}${r.frame ? ` in frame ${r.frame}` : ''}`)
      for (const c of r.created) console.log(`  ${c.id}  ${c.kind}  ${c.label}`)
      const l = csLine(r)
      if (l) console.log(l)
    })
  })

program
  .command('update <id>')
  .description('edit a block')
  .option('-t, --text <text>')
  .option('--title <title>')
  .option('-c, --color <color>')
  .option('-s, --size <size>')
  .option('--rotate <degrees>', 'rotation in degrees', (v) => Number(v))
  .option('-i, --intent <text>')
  .action((id, o) =>
    run('update_blocks', { updates: [{ id, text: o.text, title: o.title, color: o.color, size: o.size, rotation: o.rotate }], intent: o.intent }, (r) => console.log(`✓ updated ${r.updated.join(', ')}\n${csLine(r)}`)),
  )

program
  .command('image <source>')
  .description('add an image from a file path or URL, e.g. aifig image ./sketch.png --frame Inspiration')
  .option('--width <px>', 'display width', (v) => Number(v))
  .option('--caption <text>')
  .option('--inside <frame>')
  .option('--right-of <id>')
  .option('--below <id>')
  .option('-i, --intent <text>')
  .action((source: string, o) => {
    const isUrl = /^https?:\/\//.test(source)
    const abs = isUrl ? undefined : fs.realpathSync(source)
    return run('add_image', { path: abs, url: isUrl ? source : undefined, width: o.width, caption: o.caption, inside: o.inside, right_of: o.rightOf, below: o.below, intent: o.intent }, (r) => {
      console.log(`✓ added image ${r.created.find((c: { kind: string }) => c.kind === 'image')?.id}`)
      const l = csLine(r)
      if (l) console.log(l)
    })
  })

program
  .command('delete <ids...>')
  .description('delete blocks or connectors')
  .option('-i, --intent <text>')
  .action((ids, o) => run('delete_blocks', { ids, intent: o.intent }, (r) => console.log(`✓ deleted ${r.deleted.length}\n${csLine(r)}`)))

program
  .command('connect <from> <to>')
  .description('draw a connector (ids or exact text)')
  .option('--label <label>')
  .option('-r, --route <style>', 'curved (default) | elbow | straight')
  .option('-i, --intent <text>')
  .action((from, to, o) => run('connect', { connectors: [{ from, to, label: o.label, route: o.route }], intent: o.intent }, (r) => console.log(`✓ connected\n${csLine(r)}`)))

program
  .command('route <ids...>')
  .description('change connector routing, e.g. aifig route <id> --style elbow')
  .option('-s, --style <style>', 'curved | elbow | straight')
  .option('--label <label>')
  .option('-w, --waypoints <points>', 'elbow waypoints as "x,y;x,y"')
  .option('--clear-waypoints', 'return to automatic routing')
  .option('-i, --intent <text>')
  .action((ids, o) => run('update_connectors', {
    ids,
    route: o.style,
    label: o.label,
    waypoints: o.clearWaypoints ? [] : o.waypoints ? String(o.waypoints).split(';').map((p: string) => { const [x, y] = p.split(',').map(Number); return { x, y } }) : undefined,
    intent: o.intent,
  }, (r) => console.log(`✓ restyled ${r.updated.length}\n${csLine(r)}`)))

program
  .command('frame <title> <ids...>')
  .description('group blocks into a new frame')
  .action((title, ids) => run('group_into_frame', { title, ids }, (r) => console.log(`✓ frame ${r.frame}\n${csLine(r)}`)))

program
  .command('tidy')
  .description('tidy a frame or the whole board; --by type groups by block type, --by matrix --field status lays out types × values')
  .option('-f, --frame <frame>')
  .option('--by <mode>', 'position | type | matrix')
  .option('--field <field>', 'matrix columns, e.g. status or done')
  .action((o) => run('tidy', { frame: o.frame, by: o.by, matrix_field: o.field }, (r) => console.log(`✓ tidied (${r.moved} moved)\n${csLine(r)}`)))

/** `--status unverified --done` style field flags left over by commander. */
function fieldFlags(rest: string[]) {
  const out: Record<string, string | boolean> = {}
  for (let i = 0; i < rest.length; i++) {
    const m = rest[i].match(/^--([\w-]+)(?:=(.*))?$/)
    if (!m) continue
    if (m[2] !== undefined) out[m[1]] = m[2]
    else if (rest[i + 1] !== undefined && !rest[i + 1].startsWith('--')) out[m[1]] = rest[++i]
    else out[m[1]] = true
  }
  return out
}

program
  .command('types')
  .description('list the built-in block types and their fields')
  .action(() =>
    run('list_types', {}, (r) => {
      for (const t of r.types) {
        const fields = t.fields.map((f: any) => (f.kind === 'enum' ? `${f.key}=${f.options.join('|')}` : f.kind === 'boolean' ? `${f.key}=true|false` : f.key)).join('  ')
        console.log(`${t.id.padEnd(11)} ${t.color.padEnd(7)} ${t.prefixes.map((p: string) => JSON.stringify(p)).join(' ').padEnd(24)} ${fields}`)
      }
    }),
  )

program
  .command('set-type')
  .description('promote blocks to a type (fields as flags), update fields, or demote with "none", e.g. aifig set-type <id> hypothesis --status supported')
  .argument('<ids>', 'comma-separated block ids')
  .argument('[type]', 'insight | question | quote | hypothesis | idea | todo | none (omit to only update fields)')
  .option('-i, --intent <text>', 'why (shown to the reviewer)')
  .allowUnknownOption()
  .allowExcessArguments()
  .action(function (this: any, ids: string, _type: string | undefined, o: any) {
    const rest: string[] = this.args.slice(1)
    const type = rest[0] && !rest[0].startsWith('--') ? rest[0] : undefined
    const fields = fieldFlags(type ? rest.slice(1) : rest)
    return run('set_type', { ids: ids.split(','), type, fields: Object.keys(fields).length ? fields : undefined, intent: o.intent }, (r) => {
      for (const u of r.updated) console.log(`✓ ${u.id} → ${u.type ?? 'plain'}${Object.keys(u.fields).length ? `  ${JSON.stringify(u.fields)}` : ''}`)
      const line = csLine(r)
      if (line) console.log(line)
    })
  })

program
  .command('query')
  .description('find blocks by type and fields, e.g. aifig query --type hypothesis --status unverified')
  .option('-t, --type <type>', 'block type, or "none" for untyped')
  .option('-f, --frame <frame>')
  .allowUnknownOption()
  .allowExcessArguments()
  .action(function (this: any, o: any) {
    const where = fieldFlags(this.args)
    return run('query_blocks', { type: o.type, frame: o.frame, where: Object.keys(where).length ? where : undefined }, (r) => {
      console.log(`${r.count} match${r.count === 1 ? '' : 'es'}`)
      for (const b of r.blocks) console.log(`  ${b.id}  ${(b.type ?? 'plain').padEnd(10)} ${String(b.text).replace(/\s+/g, ' ').slice(0, 60)}${Object.keys(b.fields).length ? `  ${JSON.stringify(b.fields)}` : ''}`)
    })
  })

program
  .command('lint')
  .description('check the layout')
  .option('-f, --frame <frame>')
  .action((o) =>
    run('lint_layout', { frame: o.frame }, (r) => {
      console.log(r.ok && !r.issues.length ? '✓ layout looks clean' : `${r.ok ? '!' : '✗'} ${r.summary}`)
      for (const i of r.issues) console.log(`  ${i.severity === 'error' ? '✗' : '!'} ${i.rule}: ${i.message}`)
    }),
  )

program
  .command('snapshot')
  .description('render the board to PNG or SVG')
  .option('-f, --frame <frame>')
  .option('--ids <ids>', 'comma-separated block ids to render')
  .option('-o, --out <file>', 'output file', 'board.png')
  .option('--dark', 'dark theme')
  .action(async (o) => {
    const format = o.out.endsWith('.svg') ? 'svg' : 'png'
    const r = await callCore('render_snapshot', { board: program.opts().board, frame: o.frame, ids: o.ids ? String(o.ids).split(',') : undefined, format, theme: o.dark ? 'dark' : 'light' }, caller())
    if (!r.ok) {
      console.error(`✗ ${r.error}`)
      process.exit(1)
    }
    if (format === 'svg') fs.writeFileSync(o.out, (r.result as any).svg)
    else fs.writeFileSync(o.out, Buffer.from(r.image!.data, 'base64'))
    console.log(`✓ wrote ${o.out}`)
  })

program
  .command('export')
  .description('export the board as markdown, json, png or svg (markdown/json print to stdout without -o)')
  .option('--format <format>', 'md | json | png | svg', 'md')
  .option('-f, --frame <frame>')
  .option('-o, --out <file>')
  .action(async (o) => {
    const format = String(o.format).toLowerCase()
    if (format === 'png' || format === 'svg') {
      const r = await callCore('render_snapshot', { board: program.opts().board, frame: o.frame, format }, caller())
      if (!r.ok) throw new Error(r.error)
      const out = o.out ?? `board.${format}`
      fs.writeFileSync(out, format === 'svg' ? (r.result as any).svg : Buffer.from(r.image!.data, 'base64'))
      return console.log(`✓ wrote ${out}`)
    }
    const r = await callCore('export_board', { board: program.opts().board, frame: o.frame, format: format === 'json' ? 'json' : 'markdown' }, caller())
    if (!r.ok) throw new Error(r.error)
    const res = r.result as { content: string; filename: string }
    if (!o.out) {
      process.stdout.write(`${res.content}\n`)
      return
    }
    fs.writeFileSync(o.out, res.content)
    console.log(`✓ wrote ${o.out}`)
  })

program
  .command('status [text...]')
  .description('show a status next to your cursor')
  .action((text: string[]) => run('set_status', { status: text.join(' ') }, () => console.log('✓ status set')))

program
  .command('changes')
  .description('list change sets')
  .action(() =>
    run('list_change_sets', {}, (r) => {
      if (!r.changeSets.length) console.log('No change sets yet.')
      for (const c of r.changeSets) console.log(`${c.id}  ${c.status.padEnd(8)}  ${c.author}: ${c.intent} (${c.entries} edits)${c.reason ? ` — "${c.reason}"` : ''}`)
    }),
  )

for (const action of ['accept', 'reject'] as const) {
  program
    .command(`${action} [id]`)
    .description(`${action} a change set (default: all pending)`)
    .option('-r, --reason <text>')
    .action(async (id, o) => {
      const r = await callCore('review_change_set', { board: program.opts().board, id: id ?? 'all', action, reason: o.reason }, { id: 'human:cli', name: 'You', client: 'cli', kind: 'human' })
      if (!r.ok) {
        console.error(`✗ ${r.error}`)
        process.exit(1)
      }
      console.log(`✓ ${action}ed ${(r.result as any).reviewed.length} change set(s)`)
    })
}

program
  .command('call <tool> [json]')
  .description('call any Canvas API tool with a JSON argument object')
  .action((tool, jsonArg) => run(tool, jsonArg ? JSON.parse(jsonArg) : {}))

program.parseAsync(process.argv, { from: 'node' }).catch((e) => {
  console.error(`✗ ${(e as Error).message}`)
  process.exit(1)
})
