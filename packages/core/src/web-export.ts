import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assetFileName, blockAssetRefs, SINGLE_FILE_WARN_BYTES, typeDef, WEB_EXPORT_FORMAT, type Asset, type Block, type Connector, type TypeRegistry, type WebExportData } from '@aifig/shared'
import { APP_VERSION } from './fileformat'
import type { Board } from './board'
import { containsSecret } from './pack'
import { staticSnippetDocument } from './snippet-host'
import { ZipWriter } from './zip'

/**
 * Export a board as a read-only web page: `index.html`, the prebuilt viewer (`viewer.js` / `viewer.css`, from
 * apps/canvas — canvas-engine rendering, no core code), `board.js` with the board, its files in `assets/`, and
 * each inline snippet as its own sandboxed document in `snippets/` (a CSP meta tag with no network). Works from
 * file:// and any static host. `single` inlines everything into one .html (files as data: URIs).
 */

export type WebExportMode = 'folder' | 'zip' | 'single'

let buildTried = false

export function viewerDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const bin = process.env.AIFIG_BIN
  const source = path.resolve(here, '../../../apps/canvas')
  const candidates = [
    process.env.AIFIG_VIEWER_DIR,
    process.env.AIFIG_UI_DIST && path.join(process.env.AIFIG_UI_DIST, 'viewer'),
    bin && path.join(path.dirname(bin), 'ui', 'viewer'),
    path.join(source, 'dist/viewer'),
  ]
  const found = candidates.find((d): d is string => !!d && fs.existsSync(path.join(d, 'viewer.js')))
  if (found) return found
  // a source checkout running `npm run dev` has no build yet: make the viewer once (a second or two)
  if (!buildTried && !bin && fs.existsSync(path.join(source, 'vite.viewer.config.ts'))) {
    buildTried = true
    const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'build', '--config', 'vite.viewer.config.ts'], { cwd: source, stdio: 'ignore', timeout: 120_000 })
    if (r.status === 0 && fs.existsSync(path.join(source, 'dist/viewer/viewer.js'))) return path.join(source, 'dist/viewer')
  }
  return null
}

/** The page's own CSP: its files only, no fetches; frames for snippets (same folder) and https embeds. */
const PAGE_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' file:",
  "style-src 'self' 'unsafe-inline' file:",
  "img-src 'self' data: blob: file: https:",
  "media-src 'self' data: blob: file:",
  "font-src 'self' data: file:",
  "frame-src 'self' data: file: https:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
/** JSON that is safe inside a <script> element. */
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

const strip = <T extends Block | Connector>(o: T): T => {
  const { changeSet: _c, pending: _p, editedBy: _e, ...rest } = o as T & { editedBy?: unknown }
  return rest as T
}

function pageHtml(d: { title: string; lang?: string; css: string; board: string; viewer: string; inline: boolean }) {
  const head = [
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">`,
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
    '<meta name="referrer" content="no-referrer">',
    `<meta name="generator" content="ai-figma ${APP_VERSION}">`,
    `<title>${esc(d.title)} — ai-figma</title>`,
    d.inline ? `<style>${d.css.replace(/<\/style/gi, '<\\/style')}</style>` : '<link rel="stylesheet" href="viewer.css">',
  ]
  const body = d.inline ? `<script>${d.board}</script><script>${d.viewer.replace(/<\/script/gi, '<\\/script')}</script>` : '<script src="board.js"></script><script src="viewer.js"></script>'
  return `<!doctype html>\n<html lang="${esc(d.lang ?? 'en')}">\n<head>\n${head.join('\n')}\n</head>\n<body>\n<div id="root"></div>\n<noscript>This board needs JavaScript to display.</noscript>\n${body}\n</body>\n</html>\n`
}

const PUBLISHING = (title: string, comments: boolean) => `# Publishing “${title}”

This folder is a complete, read-only web page: open \`index.html\` in a browser, or put the whole folder on any
static host. Nothing here talks to a server — inline web snippets run sandboxed with no network, and URL embeds
(YouTube, Figma, …) only load when a reader clicks them.

Keep the files together: \`index.html\`, \`board.js\`, \`viewer.js\`, \`viewer.css\`, \`assets/\` and \`snippets/\`.

## Hosting it

- **Netlify Drop** — drag this folder onto https://app.netlify.com/drop.
- **GitHub Pages** — commit the folder to a repository (e.g. as \`docs/\`), then Settings › Pages › deploy from that folder.
- **Cloudflare Pages / Vercel** — create a project from the folder (no build command, output directory = the folder).
- **Amazon S3 / R2 / any bucket** — upload the folder with public read access and enable static website hosting.
- **Your own server** — copy it into any directory nginx, Apache or Caddy serves. \`npx serve .\` previews it locally.

Videos play best when the host supports HTTP range requests (all of the above do).

## Privacy

The page contains the board as it was exported${comments ? ', with its comments' : ', without comments'}. Anyone with the link can see it and download its files.
To take it down, delete it from the host.
`

export interface WebExportResult {
  path: string
  mode: WebExportMode
  size: number
  files: number
  warning?: string
}

/** Build the page's data and file list without writing anything (also used for the size estimate). */
function plan(board: Board, opts: { comments: boolean; fields: boolean; theme: 'light' | 'dark'; single: boolean }) {
  const blocks = [...board.blocks.values()]
  const ids = new Set<string>()
  for (const b of blocks) for (const id of blockAssetRefs(b)) ids.add(id)
  const assets: WebExportData['assets'] = {}
  const files: { name: string; file: string; asset: Asset }[] = []
  for (const id of ids) {
    const a = board.assets.get(id)
    if (!a?.hash || a.role.startsWith('snippet-')) continue
    const file = board.assetPath(a)
    if (!file) continue
    const name = assetFileName(a)
    if (!files.some((f) => f.name === name)) files.push({ name, file, asset: a })
    assets[id] = { src: `assets/${name}`, mime: a.mime, ...(a.name ? { name: a.name } : {}), ...(a.w ? { w: a.w, h: a.h } : {}), ...(a.duration ? { duration: a.duration } : {}) }
  }
  const snippets: WebExportData['snippets'] = {}
  const docs: { name: string; html: string }[] = []
  const outBlocks = blocks.map((b0) => {
    const b = strip(b0)
    if (b.kind !== 'web' || !b.web) return b
    const { src: _s, html: _h, css: _c, js: _j, grants: _g, ...web } = b.web
    if (b.web.mode === 'inline') {
      const html = staticSnippetDocument(b.web, board.snippetSource(b.web))
      if (opts.single) snippets[b.id] = { srcdoc: html }
      else {
        snippets[b.id] = { src: `snippets/${b.id}.html` }
        docs.push({ name: `snippets/${b.id}.html`, html })
      }
    }
    return { ...b, web }
  })
  const reg = board.types()
  const types: Record<string, TypeRegistry[string]> = {}
  for (const b of blocks) if (b.type && !types[b.type]) types[b.type] = typeDef(b.type, reg)
  const data: WebExportData = {
    format: WEB_EXPORT_FORMAT,
    title: board.title,
    exportedAt: new Date().toISOString(),
    theme: opts.theme,
    ...(board.meta.get('language') ? { language: String(board.meta.get('language')) } : {}),
    blocks: outBlocks,
    connectors: [...board.connectors.values()].map(strip),
    threads: opts.comments ? [...board.threads.values()] : [],
    types,
    assets,
    snippets,
    options: { comments: opts.comments, fields: opts.fields },
  }
  return { data, files, docs }
}

/** Roughly how large each output would be (bytes). */
export function estimateWeb(board: Board) {
  const dir = viewerDir()
  const viewer = dir ? fs.statSync(path.join(dir, 'viewer.js')).size + fs.statSync(path.join(dir, 'viewer.css')).size : 700_000
  const { data, files, docs } = plan(board, { comments: true, fields: true, theme: 'light', single: false })
  const media = files.reduce((n, f) => n + f.asset.size, 0)
  const rest = JSON.stringify(data).length + docs.reduce((n, d) => n + d.html.length, 0)
  return { folder: viewer + media + rest, single: viewer + Math.ceil(media * 1.34) + rest, warnAbove: SINGLE_FILE_WARN_BYTES, viewerBuilt: !!dir }
}

export function exportWeb(board: Board, opts: { out: string; mode: WebExportMode; comments?: boolean; fields?: boolean; theme?: 'light' | 'dark' }): WebExportResult {
  const dir = viewerDir()
  if (!dir) throw new Error('The web page viewer isn’t built — run `npm run build` (it is part of the installed app).')
  const single = opts.mode === 'single'
  const comments = opts.comments !== false
  const { data, files, docs } = plan(board, { comments, fields: opts.fields !== false, theme: opts.theme ?? 'light', single })
  if (single) {
    for (const [id, a] of Object.entries(data.assets)) {
      const f = files.find((x) => `assets/${x.name}` === a.src)
      if (f) data.assets[id] = { ...a, src: `data:${a.mime};base64,${fs.readFileSync(f.file).toString('base64')}` }
    }
  }
  const boardJs = `window.__AIFIG_BOARD__ = ${scriptJson(data)};\n`
  if (containsSecret(boardJs)) throw new Error('This board contains what looks like an access token or secret key. Remove it before exporting — nothing was written.')
  const viewerJs = fs.readFileSync(path.join(dir, 'viewer.js'), 'utf8')
  const viewerCss = fs.readFileSync(path.join(dir, 'viewer.css'), 'utf8')
  const title = board.title
  const lang = data.language === 'zh-CN' ? 'zh-CN' : 'en'
  const out = path.resolve(opts.out)
  fs.mkdirSync(path.dirname(out), { recursive: true })

  if (single) {
    const html = pageHtml({ title, lang, css: viewerCss, board: boardJs, viewer: viewerJs, inline: true })
    const tmp = `${out}.${randomBytes(3).toString('hex')}.tmp`
    fs.writeFileSync(tmp, html)
    fs.renameSync(tmp, out)
    const size = Buffer.byteLength(html)
    return { path: out, mode: 'single', size, files: 1, ...(size > SINGLE_FILE_WARN_BYTES ? { warning: `The page is ${(size / 1024 / 1024).toFixed(1)} MB. Browsers open files this large slowly, and mail or chat apps may refuse them — the folder or zip export keeps files separate.` } : {}) }
  }

  const texts: { name: string; data: string }[] = [
    { name: 'index.html', data: pageHtml({ title, lang, css: '', board: '', viewer: '', inline: false }) },
    { name: 'board.js', data: boardJs },
    { name: 'viewer.js', data: viewerJs },
    { name: 'viewer.css', data: viewerCss },
    { name: 'PUBLISHING.md', data: PUBLISHING(title, comments) },
    ...docs.map((d) => ({ name: d.name, data: d.html })),
  ]
  if (opts.mode === 'zip') {
    const root = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim() || 'board'
    const tmp = `${out}.${randomBytes(3).toString('hex')}.tmp`
    const zip = new ZipWriter(tmp)
    try {
      for (const t of texts) zip.addBuffer(`${root}/${t.name}`, Buffer.from(t.data))
      for (const f of files) zip.addFile(`${root}/assets/${f.name}`, f.file)
      zip.finish()
      fs.renameSync(tmp, out)
    } catch (e) {
      zip.abort()
      throw e
    }
    return { path: out, mode: 'zip', size: fs.statSync(out).size, files: texts.length + files.length }
  }
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error(`${out} already exists and isn’t empty — choose a new folder`)
  const staging = `${out}.${randomBytes(3).toString('hex')}.tmp`
  try {
    for (const t of texts) {
      fs.mkdirSync(path.dirname(path.join(staging, t.name)), { recursive: true })
      fs.writeFileSync(path.join(staging, t.name), t.data)
    }
    fs.mkdirSync(path.join(staging, 'assets'), { recursive: true })
    for (const f of files) fs.copyFileSync(f.file, path.join(staging, 'assets', f.name), fs.constants.COPYFILE_FICLONE)
    fs.rmSync(out, { recursive: true, force: true })
    fs.renameSync(staging, out)
  } catch (e) {
    fs.rmSync(staging, { recursive: true, force: true })
    throw e
  }
  const size = texts.reduce((n, t) => n + Buffer.byteLength(t.data), 0) + files.reduce((n, f) => n + f.asset.size, 0)
  return { path: out, mode: 'folder', size, files: texts.length + files.length }
}
