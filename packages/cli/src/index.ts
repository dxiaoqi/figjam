import fs from 'node:fs'
import path from 'node:path'
import { Command } from 'commander'
import { callCore } from './client'
import { TEMPLATE_IDS, type AnyToolName, type CallerInfo } from '@aifig/shared'

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
  else {
    print(r.result)
    for (const w of (r.result as { warnings?: string[] })?.warnings ?? []) console.error(`⚠ ${w}`)
  }
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
    const { tokenPath: tokenPathFor } = await import('@aifig/core/auth')
    const { port } = await startCore(opts.port)
    console.log(`ai-figma core listening on http://127.0.0.1:${port} — open the canvas with \`aifig open\` (API, MCP and sync require the access token in ${tokenPathFor()})`)
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
  .command('new-board [title]')
  .description('create a board, e.g. aifig new-board --template research-synthesis --lang zh-CN')
  .option('-t, --template <id>', `start from a template: ${TEMPLATE_IDS.join(' | ')}`)
  .option('-l, --lang <language>', 'template language: en | zh-CN')
  .action((title, opts) =>
    run('create_board', { title, template: opts.template, language: opts.lang }, (r) => console.log(`✓ created ${r.board.id} "${r.board.title}"${r.template ? ` from ${r.template} (${r.board.blockCount} blocks)` : ''}`)),
  )

program
  .command('templates')
  .description('list board templates')
  .action(() =>
    run('list_templates', {}, (r) => {
      for (const t of r.templates) console.log(`${t.id.padEnd(22)} ${t.title} — ${t.description}`)
    }),
  )

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
  .command('video <file>')
  .description('add a local MP4 / WebM video, e.g. aifig video ./demo.mp4 --poster ./demo.png')
  .option('--poster <image>', 'poster image (otherwise the canvas captures a frame)')
  .option('--width <px>', 'display width', (v) => Number(v))
  .option('--caption <text>')
  .option('--inside <frame>')
  .option('--right-of <id>')
  .option('--below <id>')
  .option('-i, --intent <text>')
  .action((file: string, o) =>
    run('add_video', { path: fs.realpathSync(file), poster: o.poster ? fs.realpathSync(o.poster) : undefined, width: o.width, caption: o.caption, inside: o.inside, right_of: o.rightOf, below: o.below, intent: o.intent }, (r) => {
      console.log(`✓ added video ${r.id}${r.duration ? ` (${Math.round(r.duration)} s)` : ''} → ${r.file}`)
      const l = csLine(r)
      if (l) console.log(l)
    }),
  )

const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n ? `${Math.max(1, Math.round(n / 1024))} KB` : "0 KB")

program
  .command('assets')
  .description('files the board keeps next to it: type, size, path, which blocks use them (--cleanup removes unused ones)')
  .option('--cleanup', 'remove files no block uses (history and backups keep what they need)')
  .option('--dry-run', 'with --cleanup: only show what would go')
  .action(async (o) => {
    if (o.cleanup) {
      const r = await callCore('cleanup_assets', { board: program.opts().board, dry_run: !!o.dryRun }, { id: 'human:cli', name: 'You', client: 'cli', kind: 'human' })
      if (!r.ok) {
        console.error(`✗ ${r.error}`)
        process.exit(1)
      }
      const x = r.result as { removedEntries: { name: string }[]; deleted: { name: string; size: number }[]; freed: number; keptForHistory: number; skipped?: string }
      if (program.opts().json) return console.log(JSON.stringify(x, null, 2))
      console.log(`${o.dryRun ? 'would remove' : '✓ removed'} ${x.removedEntries.length} unused file(s) from the board; ${o.dryRun ? 'would delete' : 'deleted'} ${x.deleted.length} (${mb(x.freed)})`)
      if (x.keptForHistory) console.log(`  ${x.keptForHistory} kept for version history`)
      if (x.skipped) console.log(`  ${x.skipped}`)
      return
    }
    return run('list_assets', {}, (r) => {
      console.log(`${r.board.title}: ${mb(r.totals.total)} (board ${mb(r.totals.boardFile)}, ${r.totals.assetFiles} files ${mb(r.totals.assetBytes)})`)
      console.log(`  board   ${r.board.externalPath ?? r.board.file}`)
      console.log(`  files   ${r.board.externalAssetsDir ?? r.board.assetsDir}`)
      console.log(`  history ${r.history.dir} (${r.history.versions} versions, ${mb(r.history.bytes)})`)
      console.log(`  backups ${r.backups.dir} (${r.backups.count}, ${mb(r.backups.bytes)})`)
      for (const a of r.assets) console.log(`${a.status === 'used' ? ' ' : a.status === 'missing' ? '!' : '·'} ${a.id}  ${a.role.padEnd(12)} ${mb(a.size).padStart(8)}  ${a.name ?? ''}  ${a.usedBy.length ? `used by ${a.usedBy.map((u: { id: string }) => u.id).join(', ')}` : a.status}`)
    })
  })

program
  .command('replace <target> <file>')
  .description('replace a file the board uses (asset id, or block id; --part poster|html|css|js)')
  .option('--part <part>', 'file (default) | poster | html | css | js')
  .option('-i, --intent <text>')
  .action((target: string, file: string, o) =>
    run('replace_asset', { ...(target.startsWith('a') && target.length === 17 ? { asset: target } : { block: target }), part: o.part, path: fs.realpathSync(file), intent: o.intent }, (r) => {
      console.log(`✓ replaced in ${r.blocks.length} block(s) → ${r.file ?? r.with}`)
      const l = csLine(r)
      if (l) console.log(l)
    }),
  )

program
  .command('snippet-files <id>')
  .description('editable index.html / style.css / script.js for an inline web snippet; saves update the canvas live')
  .option('--open', 'open them in your code editor')
  .action(async (id: string, o) => {
    if (o.open) {
      const r = await callCore('reveal_asset', { board: program.opts().board, block: id, open: true }, { id: 'human:cli', name: 'You', client: 'cli', kind: 'human' })
      if (!r.ok) {
        console.error(`✗ ${r.error}`)
        process.exit(1)
      }
    }
    return run('edit_snippet_files', { id }, (r) => {
      console.log(r.dir)
      for (const f of Object.values(r.files)) console.log(`  ${f}`)
      console.log(r.note)
    })
  })

program
  .command('pack')
  .description('share the board as a .aifigpack (board, files, skills; --history, --no-comments)')
  .option('-o, --out <file>', 'where to write it (default: ./<title>.aifigpack)')
  .option('--history', 'include version history')
  .option('--no-comments', 'leave comment threads out')
  .option('--force', 'overwrite an existing file')
  .action(async (o) => {
    let out = o.out
    if (!out) {
      const b = await callCore('get_board', { board: program.opts().board }, caller())
      const title = b.ok ? String((b.result as { markdown: string }).markdown.match(/^# (.+) \(board id/)?.[1] ?? 'board') : 'board'
      out = `${title.replace(/[\\/:*?"<>|]+/g, '-')}.aifigpack`
    }
    return run('export_pack', { path: path.resolve(out), include_history: !!o.history, include_comments: o.comments !== false, overwrite: !!o.force }, (r) => {
      console.log(`✓ ${r.path} (${mb(r.size)}, ${r.files} files${r.includes.history ? ', with history' : ''}${r.includes.comments ? '' : ', no comments'}${r.includes.skills.length ? `, skills: ${r.includes.skills.join(', ')}` : ''})`)
      for (const n of r.notes ?? []) console.log(`  ${n}`)
    })
  })

program
  .command('unpack <file>')
  .description('open a .aifigpack: check it, save the board in a folder (default ~/Documents/ai-figma) and open it')
  .option('--to <dir>', 'folder for the board')
  .option('--install-skills', 'also install the skills in the pack')
  .action((file: string, o) =>
    run('import_pack', { path: path.resolve(file), dest: o.to ? path.resolve(o.to) : undefined, install_skills: !!o.installSkills }, (r) => {
      console.log(`✓ opened ${r.board.id} "${r.board.title}" → ${r.path}`)
      console.log(`  ${r.board.blockCount} blocks, ${r.history} versions, ${r.comments} comment threads`)
      if (r.skills.installed.length) console.log(`  installed skills: ${r.skills.installed.join(', ')}`)
      if (r.next) console.log(`  ${r.next}`)
      for (const n of r.notes ?? []) console.log(`  ${n}`)
    }),
  )

program
  .command('storage')
  .description('print where the board, its files, history and backups are (--reveal opens the files folder)')
  .option('--reveal', 'show the files folder in the file manager')
  .action(async (o) => {
    const who = { id: 'human:cli', name: 'You', client: 'cli', kind: 'human' } as const
    const r = await callCore(o.reveal ? 'reveal_asset' : 'get_storage', { board: program.opts().board, ...(o.reveal ? { what: 'assets' } : {}) }, who)
    if (!r.ok) {
      console.error(`✗ ${r.error}`)
      process.exit(1)
    }
    const x = r.result as any
    if (o.reveal) return console.log(x.path)
    console.log(JSON.stringify({ board: x.board, totals: x.totals, history: x.history, backups: x.backups }, null, 2))
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

const readSource = (v?: string) => (v === undefined ? undefined : v.startsWith('@') ? fs.readFileSync(v.slice(1) === '-' ? 0 : v.slice(1), 'utf8') : v)

program
  .command('snippet')
  .description('add a web snippet: --url <https://…> to embed, or --html/--css/--js (text, or @file) for an inline snippet')
  .option('--url <url>')
  .option('--html <html>')
  .option('--css <css>')
  .option('--js <js>')
  .option('--title <title>')
  .option('--size <w,h>', 'e.g. 480,320')
  .option('--at <x,y>')
  .option('--inside <frame>')
  .option('--right-of <id>')
  .option('-i, --intent <text>')
  .action((o) => {
    const [width, height] = o.size ? String(o.size).split(',').map(Number) : []
    const at = o.at ? (([x, y]) => ({ x, y }))(String(o.at).split(',').map(Number)) : undefined
    return run('create_snippet', { url: o.url, html: readSource(o.html), css: readSource(o.css), js: readSource(o.js), title: o.title, width, height, at, inside: o.inside, right_of: o.rightOf, intent: o.intent }, (r) => {
      console.log(`✓ added ${r.mode === 'url' ? `embed (${r.embedUrl})` : 'inline snippet'} ${r.id}`)
      const line = csLine(r)
      if (line) console.log(line)
    })
  })

program
  .command('snippet-update')
  .description('change a web snippet (only the parts you pass)')
  .argument('<id>')
  .option('--url <url>')
  .option('--html <html>')
  .option('--css <css>')
  .option('--js <js>')
  .option('--title <title>')
  .option('-i, --intent <text>')
  .action((id: string, o) =>
    run('update_snippet', { id, url: o.url, html: readSource(o.html), css: readSource(o.css), js: readSource(o.js), title: o.title, intent: o.intent }, (r) => {
      console.log(`✓ updated snippet ${r.id}`)
      const line = csLine(r)
      if (line) console.log(line)
    }),
  )

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
  .option('--inline-images', 'markdown: embed images as data: URIs')
  .action(async (o) => {
    const format = String(o.format).toLowerCase()
    if (format === 'png' || format === 'svg') {
      const r = await callCore('render_snapshot', { board: program.opts().board, frame: o.frame, format }, caller())
      if (!r.ok) throw new Error(r.error)
      const out = o.out ?? `board.${format}`
      fs.writeFileSync(out, format === 'svg' ? (r.result as any).svg : Buffer.from(r.image!.data, 'base64'))
      return console.log(`✓ wrote ${out}`)
    }
    const r = await callCore('export_board', { board: program.opts().board, frame: o.frame, format: format === 'json' ? 'json' : 'markdown', images: o.inlineImages ? 'inline' : undefined }, caller())
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

const KIND_LABEL: Record<string, string> = { auto: 'auto', checkpoint: 'checkpoint', 'before-restore': 'pre-restore', recovered: 'recovered', opened: 'opened' }

program
  .command('versions')
  .description('version history of the board (newest first)')
  .option('-n, --limit <n>', 'how many', (v) => Number(v))
  .action((o) =>
    run('list_versions', { limit: o.limit }, (r) => {
      if (!r.versions.length) return console.log('No versions yet — they are taken automatically as the board changes, or with `aifig checkpoint "name"`.')
      for (const v of r.versions) {
        const at = new Date(v.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
        console.log(`${v.id}  ${at.padEnd(20)}  ${(KIND_LABEL[v.kind] ?? v.kind).padEnd(11)}  ${String(v.blockCount).padStart(4)} blocks  ${v.name}`)
      }
    }),
  )

program
  .command('checkpoint <name...>')
  .description('save a named checkpoint of the board')
  .action((name: string[]) => run('create_version', { name: name.join(' ') }, (r) => console.log(`✓ checkpoint ${r.version.id} “${r.version.name}” (${r.version.blockCount} blocks)`)))

program
  .command('restore <version>')
  .description('restore a version (the current state is checkpointed first; as an agent it goes through review)')
  .action((version: string) =>
    run('restore_version', { version }, (r) => {
      if (r.unchanged) return console.log('The board already matches that version.')
      const s = r.summary
      console.log(`✓ restored ${r.restored}: ${s.added} back, ${s.removed} removed, ${s.changed} changed`)
      console.log(r.changeSet ? csLine(r) : `  undo with: aifig --human restore ${r.checkpoint}`)
    }),
  )

program
  .command('backups')
  .description('print (or --open) the backup folder')
  .option('--open', 'open it in the file manager')
  .action(async (o) => {
    const r = await callCore('open_backup_folder', { board: program.opts().board, reveal: !!o.open }, { id: 'human:cli', name: 'You', client: 'cli', kind: 'human' })
    if (!r.ok) {
      console.error(`✗ ${r.error}`)
      process.exit(1)
    }
    console.log((r.result as { path: string }).path)
  })

program
  .command('token')
  .description('print the local access token (for MCP-over-HTTP configs); --rotate replaces it')
  .option('--rotate', 'generate a new token; clients reading AIFIG_HOME pick it up, pasted configs must be updated')
  .action(async (o) => {
    const { loadOrCreateToken, rotateToken, tokenPath } = await import('@aifig/core/auth')
    const t = o.rotate ? rotateToken() : loadOrCreateToken()
    if (o.rotate) console.error(`✓ rotated ${tokenPath()} — reconnect HTTP MCP clients and reopen browser tabs with \`aifig open\``)
    console.log(t)
  })

program
  .command('open')
  .description('open the canvas in your browser, signed in with the access token')
  .option('--dev', 'open the Vite dev server (npm run dev) instead of the core')
  .option('--print', 'print the link instead of opening it')
  .action(async (o) => {
    const { ensureCore, base } = await import('./client')
    await ensureCore()
    const { loadOrCreateToken } = await import('@aifig/core/auth')
    const origin = o.dev ? `http://127.0.0.1:${process.env.AIFIG_UI_PORT ?? 47820}` : base()
    const link = `${origin}/#token=${loadOrCreateToken()}`
    if (o.print) return console.log(link)
    const { spawn } = await import('node:child_process')
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
    spawn(cmd, [link], { stdio: 'ignore', detached: true }).on('error', () => console.log(link)).unref()
  })

program
  .command('permissions [action] [subject] [capability] [target]')
  .description('list grants and pending requests; `allow agent:<client> network <host|*>`; `revoke agent:<client> [capability] [target]`')
  .action(async (action, subject, capability, target) => {
    const { coreFetch } = await import('./client')
    const actor = { id: 'human:cli', name: 'You', client: 'cli', kind: 'human' }
    if (action === 'allow' || action === 'revoke') {
      const r = (await (await coreFetch(`/api/permissions/${action === 'allow' ? 'grant' : 'revoke'}`, { method: 'POST', body: JSON.stringify({ subject, capability, target, actor }) })).json()) as any
      if (!r.ok) {
        console.error(`✗ ${r.error}`)
        process.exit(1)
      }
      console.log(action === 'allow' ? `✓ ${subject} may use ${capability} for ${target}` : `✓ removed ${r.removed} grant(s)`)
      return
    }
    const r = (await (await coreFetch('/api/permissions')).json()) as any
    if (program.opts().json) return console.log(JSON.stringify(r, null, 2))
    if (!r.grants.length) console.log('No grants. Agents are asked in the canvas before they touch the network or secrets.')
    for (const g of r.grants) console.log(`${g.subject.padEnd(24)} ${g.capability.padEnd(8)} ${g.target}`)
    for (const p of r.pending) console.log(`pending: ${p.actor.name} wants ${p.capability} for ${p.target} (${p.reason})`)
  })

program
  .command('activity')
  .description('recent network, secret, permission and auth events')
  .option('-n, --limit <n>', 'how many', (v) => Number(v), 30)
  .option('-c, --category <category>', 'network | secret | permission | auth')
  .action(async (o) => {
    const { coreFetch } = await import('./client')
    const q = new URLSearchParams({ limit: String(o.limit), ...(o.category ? { category: o.category } : {}) })
    const { entries } = (await (await coreFetch(`/api/activity?${q}`)).json()) as any
    if (program.opts().json) return console.log(JSON.stringify(entries, null, 2))
    if (!entries.length) console.log('No activity yet.')
    for (const e of entries) console.log(`${new Date(e.at).toISOString().slice(0, 19).replace('T', ' ')}  ${e.category.padEnd(10)} ${e.outcome.padEnd(7)} ${e.actor.name}: ${e.action}${e.target ? ` ${e.target}` : ''}${e.via ? ` (${e.via})` : ''}${e.detail ? ` — ${e.detail}` : ''}`)
  })

program
  .command('call <tool> [json]')
  .description('call any Canvas API tool with a JSON argument object')
  .action((tool, jsonArg) => run(tool, jsonArg ? JSON.parse(jsonArg) : {}))

// ---- skills -------------------------------------------------------------------

const skill = program.command('skill').description('create, develop, install and enable skills (SKILL.md + canvas/blocks.json)')

function printValidation(r: { name: string; errors: string[]; warnings: string[] }, ok: string) {
  for (const w of r.warnings) console.log(`  ⚠ ${w}`)
  if (r.errors.length) {
    console.log(`✗ ${r.name}: ${r.errors.length} problem${r.errors.length === 1 ? '' : 's'}`)
    for (const e of r.errors) console.log(`  • ${e}`)
    return false
  }
  console.log(ok)
  return true
}

skill
  .command('new')
  .description('scaffold a skill folder: SKILL.md + canvas/blocks.json with an example type, layout and prompt')
  .argument('<name>', 'kebab-case, e.g. persona-kit')
  .option('-d, --dir <dir>', 'parent folder', '.')
  .option('--tools <tools>', 'comma-separated tools for an L1 skill, e.g. web.search')
  .action(async (name: string, o) => {
    const { writeSkillFolder, loadSkill } = await import('@aifig/core')
    const path = await import('node:path')
    const dir = path.resolve(o.dir, name)
    if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
      console.error(`✗ ${dir} already exists and is not empty`)
      process.exit(1)
    }
    const tools = o.tools ? String(o.tools).split(',').map((t: string) => t.trim()).filter(Boolean) : []
    writeSkillFolder(dir, {
      name,
      description: `Describe what ${name} does and when an agent should use it (this is what agents read first).`,
      capability: tools.length ? 'L1' : 'L0',
      tools,
      instructions: `# ${name}\n\nTell agents how to use your block types: what goes in each field, how to connect them, which layout to use.\n\n- \`${name}.item\` — one item per card. Fill \`status\` and \`owner\`.\n`,
      blocks: {
        types: {
          item: {
            label: 'Item',
            plural: 'Items',
            base: 'card',
            color: 'blue',
            icon: 'Tag',
            description: 'An example type — rename it and change the fields.',
            fields: [
              { key: 'status', label: 'Status', kind: 'enum', options: ['todo', 'doing', 'done'], default: 'todo' },
              { key: 'owner', label: 'Owner', kind: 'text' },
            ],
            template: { rows: ['status', 'owner'] },
          },
        },
        relations: [],
        layouts: [{ id: 'board', label: 'Status board', intent: 'cluster', field: 'status' }],
        actions: [],
        prompts: [{ id: 'start', label: 'Get started', text: `Create a few ${name}.item cards and apply the ${name}.board layout.` }],
      },
    })
    const r = loadSkill(dir, 'dev')
    printValidation(r, `✓ created ${dir}\n  next: aifig skill dev ${path.relative(process.cwd(), dir).startsWith('..') ? dir : path.relative(process.cwd(), dir) || '.'}   (live reload into the canvas)`)
  })

skill
  .command('validate')
  .description('check a skill folder without installing it')
  .argument('[dir]', 'skill folder', '.')
  .action(async (dir: string) => {
    const { loadSkill } = await import('@aifig/core')
    const r = loadSkill(dir, 'dev')
    if (!printValidation(r, `✓ ${r.name} ${r.version} (${r.capability}) — ${r.canvas.types.length} type(s), ${r.canvas.layouts.length} layout(s), ${r.canvas.actions.length} action(s)`)) process.exit(1)
  })

skill
  .command('dev')
  .description('develop a skill: validate on every save and hot-reload it into boards that have it enabled')
  .argument('[dir]', 'skill folder', '.')
  .option('--enable', 'also enable it on the board (default: the board open in the canvas)')
  .action(async (dir: string, o) => {
    const path = await import('node:path')
    const abs = path.resolve(dir)
    let first = true
    const reload = async () => {
      const r = await callCore('load_dev_skill', { path: abs }, { id: 'human:cli', name: 'You', client: 'cli', kind: 'human' })
      if (!r.ok) return console.error(`✗ ${r.error}`)
      const v = r.result as { name: string; version: string; errors: string[]; warnings: string[]; types: string[]; boardsUpdated: string[] }
      const stamp = new Date().toLocaleTimeString()
      const ok = printValidation(v, `✓ [${stamp}] ${v.name} ${v.version} — ${v.types.length} type(s)${v.boardsUpdated.length ? ` · reloaded on ${v.boardsUpdated.length} board(s)` : ''}`)
      if (ok && first && o.enable) {
        const e = await callCore('enable_skill', { board: program.opts().board, name: v.name }, { id: 'human:cli', name: 'You', client: 'cli', kind: 'human' })
        console.log(e.ok ? `✓ enabled ${v.name} on the board` : `✗ ${e.error}`)
      }
      first = false
    }
    await reload()
    console.log(`  watching ${abs} — Ctrl-C to stop`)
    let timer: ReturnType<typeof setTimeout> | null = null
    fs.watch(abs, { recursive: true }, (_e, file) => {
      if (file && /(^|\/)\.|~$|\.swp$/.test(String(file))) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(reload, 150)
    })
  })

skill
  .command('list')
  .description('skills on this machine, and which are enabled on the board')
  .action(() =>
    run('list_skills', {}, (r) => {
      for (const s of r.skills) {
        const tools = s.tools.length ? ` · tools: ${s.tools.map((t: { name: string; available: boolean }) => `${t.name}${t.available ? '' : ' (not configured)'}`).join(', ')}` : ''
        console.log(`${s.enabled ? '●' : '○'} ${s.name.padEnd(22)} ${s.version.padEnd(8)} ${s.capability} ${s.source.padEnd(8)} ${s.types.map((t: { id: string }) => t.id).join(', ')}${tools}${s.errors ? `  ✗ ${s.errors.length} problem(s)` : ''}`)
      }
    }),
  )

skill
  .command('show')
  .description("a skill's instructions, types, layouts and actions")
  .argument('<name>')
  .action((name: string) =>
    run('get_skill', { name }, (r) => {
      console.log(`${r.name} ${r.version} (${r.capability})\n${r.description}\n`)
      console.log(r.instructions)
      console.log(`\nTypes: ${r.types.map((t: { id: string; fields: { key: string }[] }) => `${t.id} [${t.fields.map((f) => f.key).join(', ')}]`).join('; ')}`)
      if (r.layouts.length) console.log(`Layouts: ${r.layouts.map((l: { id: string }) => l.id).join(', ')}`)
      if (r.actions.length) console.log(`Actions: ${r.actions.map((a: { id: string; tool: string }) => `${a.id} (${a.tool})`).join(', ')}`)
    }),
  )

skill
  .command('install')
  .description('validate a skill folder and copy it into ~/.aifig/skills')
  .argument('<dir>')
  .action(async (dir: string) => {
    const path = await import('node:path')
    return run('install_skill', { path: path.resolve(dir) }, (r) => console.log(`✓ installed ${r.installed} ${r.version} → ${r.path}`))
  })

for (const verb of ['enable', 'disable'] as const) {
  skill
    .command(verb)
    .description(`${verb} a skill on the board`)
    .argument('<name>')
    .action((name: string) => run(`${verb}_skill` as AnyToolName, { name }, (r) => console.log(`✓ ${verb}d ${name}${r.types?.length ? ` — types: ${r.types.join(', ')}` : ''}`)))
}

skill
  .command('activity')
  .description('skill activity log for the board (tool calls, permissions)')
  .option('-s, --skill <name>')
  .action((o) =>
    run('list_activity', { skill: o.skill, limit: 50 }, (r) => {
      for (const e of r.activity) console.log(`${new Date(e.at).toLocaleString()}  ${String(e.source?.id ?? '').padEnd(18)} ${String(e.category === 'permission' ? 'permission' : e.action).padEnd(10)} ${String(e.outcome).padEnd(8)} ${e.target ?? ''} ${e.detail ?? ''}`)
      if (r.grants.length) console.log(`\nAllowed: ${r.grants.map((g: { subject: string; target: string }) => `${g.subject.replace(/^skill:/, '')} → ${g.target}`).join(', ')}  (revoke: aifig permissions revoke <skill:name> tool <tool>)`)
    }),
  )

// The Linux AppImage launcher adds --no-sandbox (an Electron flag) when user namespaces are off; agent configs
// append it themselves so it lands here as a harmless trailing argument instead of breaking Node mode.
program.parseAsync(process.argv.filter((a, i) => i < 2 || a !== '--no-sandbox'), { from: 'node' }).catch((e) => {
  console.error(`✗ ${(e as Error).message}`)
  process.exit(1)
})
