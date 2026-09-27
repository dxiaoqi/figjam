import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import * as Y from 'yjs'
import { ASSET_FILE_RE, type Asset, type Block, type BoardSkill } from '@aifig/shared'
import { AssetStore, sha256Hex } from './assets'
import { readToken } from './auth'
import type { Board, BoardRegistry } from './board'
import { APP_VERSION, decodeContainer, encodeContainer, readHeader } from './fileformat'
import { loadSkill, type SkillLibrary, writeSkillFolder } from './skills'
import { unusedEntries } from './storage'
import { extractEntry, readZipIndex, ZipError, type ZipItem, type ZipLimits } from './unzip'
import { docAssetFiles, historyDir, listVersions, readVersion } from './versions'
import { ZipWriter } from './zip'

/**
 * `.aifigpack`: one board to hand to someone else. A zip with
 *
 *   manifest.json        format + version, what's included, SHA-256 and size of every other file
 *   board.aifig          the board (comments optional)
 *   assets/<sha256>.ext  every file the board (and included history) uses
 *   skills/<name>/…      the skills enabled on the board (SKILL.md, canvas/)
 *   history/<v>.aifig    version history (optional)
 *
 * Never inside: the access token, permission grants, secrets, snippet grants, or anything outside the board.
 * Import checks everything before a byte lands in the chosen folder (see unzip.ts and importPack).
 */

export const PACK_FORMAT = 'aifigpack'
export const PACK_VERSION = 1
export const PACK_EXT = '.aifigpack'

export interface PackManifest {
  format: typeof PACK_FORMAT
  version: number
  createdAt: string
  app: string
  board: { title: string; schema: string; blocks: number; file: 'board.aifig' }
  includes: { history: boolean; comments: boolean; skills: string[] }
  files: { path: string; size: number; sha256: string }[]
  /** Files the board names that weren't found when packing. */
  missing?: string[]
}

export const PACK_LIMITS: ZipLimits = {
  maxEntries: 20_000,
  maxTotal: 2 * 1024 ** 3,
  maxEntry: (name) => (name.startsWith('assets/') ? 1024 ** 3 : name.startsWith('skills/') ? 2 * 1024 ** 2 : name === 'manifest.json' ? 1024 ** 2 : 256 * 1024 ** 2),
  maxRatio: 200,
}

/** Credentials that must never leave the machine in a pack. */
function secretPatterns(): RegExp[] {
  const token = readToken()
  return [
    ...(token ? [new RegExp(token.replace(/[-]/g, '\\-'))] : []),
    /sk-ant-[\w-]{20,}/,
    /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
    /\bxox[baprs]-[\w-]{10,}/,
  ]
}
export const containsSecret = (text: string) => secretPatterns().some((re) => re.test(text))

const SKILL_FILE_OK = /\.(md|json|txt|ya?ml|png|jpe?g|svg|webp)$/i
const SKILL_FILE_NEVER = /(^|\/)(\.[^/]*|node_modules|examples|permissions\.json|access-token|secrets?\.[\w.]+|.*\.(pem|key|p12|pfx))(\/|$)/i

/** A copy of the board document for sharing: no comments unless asked, no snippet grants, no unused files. */
function shareableDoc(src: Y.Doc, opts: { comments: boolean; drop?: Set<string> }) {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(src))
  doc.transact(() => {
    if (!opts.comments) doc.getMap('threads').clear()
    const blocks = doc.getMap<Block>('blocks')
    for (const [id, b] of [...blocks.entries()]) if (b.web?.grants?.length) blocks.set(id, { ...b, web: { ...b.web, grants: [] } })
    const assets = doc.getMap<Asset>('assets')
    for (const id of opts.drop ?? []) assets.delete(id)
  })
  return doc
}

function skillFiles(dir: string): { rel: string; file: string }[] {
  const out: { rel: string; file: string }[] = []
  const walk = (d: string, rel: string, depth: number) => {
    if (depth > 4) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (SKILL_FILE_NEVER.test(r)) continue
      if (e.isDirectory()) walk(path.join(d, e.name), r, depth + 1)
      else if (e.isFile() && SKILL_FILE_OK.test(e.name)) out.push({ rel: r, file: path.join(d, e.name) })
    }
  }
  walk(dir, '', 0)
  return out
}

/** The skill as the board has it, when this machine has no folder for it. */
function skillFromSnapshot(s: BoardSkill, into: string) {
  writeSkillFolder(into, {
    name: s.name,
    description: s.description,
    version: s.version,
    capability: s.capability === 'L1' ? 'L1' : 'L0',
    tools: s.permissions?.tools,
    instructions: s.instructions,
    blocks: s.canvas as never,
  })
  return into
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/^[.\s-]+|[.\s]+$/g, '').slice(0, 80) || 'Shared board'

/** Write a pack of `board` to `out`. Throws if the board somehow contains the access token. */
export function exportPack(board: Board, skills: SkillLibrary, out: string, opts: { history?: boolean; comments?: boolean } = {}) {
  const comments = opts.comments !== false
  const history = !!opts.history
  const warnings: string[] = []
  board.saveNow()
  const doc = shareableDoc(board.doc, { comments, drop: new Set(unusedEntries(board).map((a) => a.id)) })
  const payload = Y.encodeStateAsUpdate(doc)
  const token = readToken()
  if (token && Buffer.from(payload).includes(Buffer.from(token))) throw new Error('This board contains the ai-figma access token (pasted into a block?). Remove it before sharing — nothing was written.')
  const files = docAssetFiles(doc)
  const boardBytes = encodeContainer(payload, { savedAt: Date.now(), title: board.title, schema: board.schemaLabel, assets: files })
  const entries: { path: string; data?: Uint8Array; file?: string; store?: boolean }[] = [{ path: 'board.aifig', data: boardBytes }]
  const wanted = new Set(files)
  if (history) {
    for (const v of listVersions(board.id)) {
      try {
        const r = readVersion(board.id, v.id)
        let bytes: Uint8Array = fs.readFileSync(r.file)
        if (!comments) {
          const vdoc = new Y.Doc()
          Y.applyUpdate(vdoc, r.payload)
          const clean = shareableDoc(vdoc, { comments: false })
          bytes = encodeContainer(Y.encodeStateAsUpdate(clean), { savedAt: r.header!.savedAt, title: r.header!.title, schema: r.header!.schema, version: r.header!.version, assets: docAssetFiles(clean) })
        }
        for (const f of readHeader(bytes).header.assets ?? []) wanted.add(f)
        entries.push({ path: `history/${v.id}.aifig`, data: bytes })
      } catch {
        warnings.push(`Version ${v.id} can’t be read and was left out`)
      }
    }
  }
  const missing: string[] = []
  for (const name of wanted) {
    const m = name.match(ASSET_FILE_RE)!
    const asset = { hash: m[1], ext: m[2] } as Asset
    const p = board.assetPath(asset) ?? (board.store.has(m[1], m[2]) ? board.store.file(m[1], m[2]) : null)
    if (!p || !board.store.verify(m[1], m[2])) {
      missing.push(name)
      continue
    }
    entries.push({ path: `assets/${name}`, file: p })
  }
  if (missing.length) warnings.push(`${missing.length} file(s) the board names are missing and were left out`)
  const skillNames: string[] = []
  const staging = fs.mkdtempSync(path.join(path.dirname(out), '.aifigpack-skills-'))
  try {
    for (const s of board.skills.values()) {
      const lib = skills.get(s.name)
      const dir = lib?.path && fs.existsSync(path.join(lib.path, 'SKILL.md')) ? lib.path : skillFromSnapshot(s, path.join(staging, s.name))
      let added = 0
      for (const f of skillFiles(dir)) {
        const data = fs.readFileSync(f.file)
        if (/\.(md|json|txt|ya?ml|svg)$/i.test(f.rel) && containsSecret(data.toString('utf8'))) {
          warnings.push(`skills/${s.name}/${f.rel} looks like it contains a credential and was left out`)
          continue
        }
        entries.push({ path: `skills/${s.name}/${f.rel}`, data })
        added++
      }
      if (added) skillNames.push(s.name)
    }
    const manifest: PackManifest = {
      format: PACK_FORMAT,
      version: PACK_VERSION,
      createdAt: new Date().toISOString(),
      app: APP_VERSION,
      board: { title: board.title, schema: board.schemaLabel, blocks: doc.getMap('blocks').size, file: 'board.aifig' },
      includes: { history, comments, skills: skillNames },
      files: [],
      ...(missing.length ? { missing } : {}),
    }
    for (const e of entries) {
      if (e.data) manifest.files.push({ path: e.path, size: e.data.byteLength, sha256: sha256Hex(e.data) })
      else {
        const m = path.basename(e.path).match(ASSET_FILE_RE)!
        manifest.files.push({ path: e.path, size: fs.statSync(e.file!).size, sha256: m[1] })
      }
    }
    const tmp = `${out}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`
    const zip = new ZipWriter(tmp)
    try {
      zip.addBuffer('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)))
      for (const e of entries) {
        if (e.file) zip.addFile(e.path, e.file)
        else zip.addBuffer(e.path, e.data!, /\.aifig$/.test(e.path))
      }
      zip.finish()
      fs.renameSync(tmp, out)
    } catch (err) {
      zip.abort()
      throw err
    }
    return { file: out, size: fs.statSync(out).size, manifest, warnings }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
}

/** What a pack holds, checked (sizes, paths, manifest) without extracting anything but the manifest. */
export function inspectPack(file: string) {
  const fd = fs.openSync(file, 'r')
  try {
    const items = readZipIndex(fd, PACK_LIMITS)
    return { manifest: readManifest(fd, items), items }
  } finally {
    fs.closeSync(fd)
  }
}

function readManifest(fd: number, items: ZipItem[]): PackManifest {
  const it = items.find((i) => i.name === 'manifest.json')
  if (!it) throw new ZipError('Not an ai-figma pack (no manifest.json)')
  let m: PackManifest
  try {
    m = JSON.parse(extractEntry(fd, it).data!.toString('utf8'))
  } catch (e) {
    throw e instanceof ZipError ? e : new ZipError('The pack’s manifest is damaged')
  }
  if (m?.format !== PACK_FORMAT) throw new ZipError('Not an ai-figma pack')
  if (typeof m.version !== 'number' || m.version > PACK_VERSION) throw new ZipError(`This pack was made by a newer ai-figma (pack format ${m.version}). Update ai-figma to open it.`)
  if (!Array.isArray(m.files) || m.files.some((f) => typeof f?.path !== 'string' || typeof f.sha256 !== 'string' || typeof f.size !== 'number')) throw new ZipError('The pack’s manifest is damaged')
  const listed = new Map(m.files.map((f) => [f.path, f]))
  if (listed.size !== m.files.length) throw new ZipError('The pack’s manifest lists a file twice')
  for (const i of items) {
    if (i.name === 'manifest.json') continue
    const f = listed.get(i.name)
    if (!f) throw new ZipError(`“${i.name}” is in the pack but not in its manifest`)
    if (f.size !== i.size) throw new ZipError(`“${i.name}” doesn’t match the size in the manifest`)
  }
  for (const f of m.files) if (!items.some((i) => i.name === f.path)) throw new ZipError(`“${f.path}” is listed in the manifest but missing from the pack`)
  if (!listed.has('board.aifig')) throw new ZipError('The pack has no board')
  return m
}

/** Where a pack entry may go, relative to the staging folder; null means it has no business in a pack. */
function packTarget(name: string): string | null {
  if (name === 'board.aifig') return name
  const a = name.match(/^assets\/([^/]+)$/)
  if (a) return ASSET_FILE_RE.test(a[1]) ? name : null
  if (/^history\/v[0-9a-z]{4,40}\.aifig$/.test(name)) return name
  const s = name.match(/^skills\/([a-z0-9][a-z0-9-]{0,63})\/(.+)$/)
  if (s && !SKILL_FILE_NEVER.test(s[2]) && SKILL_FILE_OK.test(s[2]) && s[2].split('/').length <= 4) return name
  return null
}

export interface ImportResult {
  board: Board
  path: string
  manifest: PackManifest
  history: number
  skills: { installed: string[]; available: string[]; skipped: { name: string; reason: string }[] }
  warnings: string[]
}

/**
 * Check a pack completely (paths, sizes, CRCs, manifest checksums, the board's own checksum), then put the
 * board in `destDir` as `<Title>.aifig` + `<Title>.assets/` (never replacing anything there) and open it.
 * Skills are installed only when asked; version history joins the new board's history.
 */
export function importPack(registry: BoardRegistry, skills: SkillLibrary, file: string, destDir: string, opts: { installSkills?: boolean } = {}): ImportResult {
  const dest = path.resolve(destDir)
  fs.mkdirSync(dest, { recursive: true })
  const staging = fs.mkdtempSync(path.join(dest, '.aifigpack-'))
  const warnings: string[] = []
  const fd = fs.openSync(file, 'r')
  try {
    const items = readZipIndex(fd, PACK_LIMITS)
    const manifest = readManifest(fd, items)
    const sums = new Map(manifest.files.map((f) => [f.path, f.sha256]))
    for (const it of items) {
      if (it.name === 'manifest.json') continue
      const rel = packTarget(it.name)
      if (!rel) throw new ZipError(`“${it.name}” doesn’t belong in an ai-figma pack`)
      const target = path.join(staging, ...rel.split('/'))
      if (!target.startsWith(staging + path.sep)) throw new ZipError(`Unsafe path in the pack: “${it.name}”`)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      const { sha256 } = extractEntry(fd, it, target)
      if (sha256 !== sums.get(it.name)) throw new ZipError(`“${it.name}” doesn’t match its checksum`)
      const asset = rel.match(/^assets\/([0-9a-f]{64})\./)
      if (asset && asset[1] !== sha256) throw new ZipError(`“${it.name}” doesn’t match its name`)
    }
    const boardBytes = fs.readFileSync(path.join(staging, 'board.aifig'))
    const decoded = decodeContainer(boardBytes, 'board.aifig')
    for (const f of decoded.header?.assets ?? []) if (!fs.existsSync(path.join(staging, 'assets', f))) warnings.push(`${f} is missing from the pack`)

    const base = safeName(manifest.board?.title ?? '')
    let name = base
    for (let n = 2; fs.existsSync(path.join(dest, `${name}.aifig`)) || fs.existsSync(path.join(dest, `${name}.assets`)); n++) name = `${base} ${n}`
    const boardFile = path.join(dest, `${name}.aifig`)
    const assetsDir = path.join(dest, `${name}.assets`)
    fs.renameSync(path.join(staging, 'board.aifig'), boardFile)
    if (fs.existsSync(path.join(staging, 'assets'))) {
      fs.renameSync(path.join(staging, 'assets'), assetsDir)
      for (const f of fs.readdirSync(assetsDir)) fs.chmodSync(path.join(assetsDir, f), 0o444)
    }
    const board = registry.openFile(boardFile)

    let history = 0
    const hdir = path.join(staging, 'history')
    if (fs.existsSync(hdir)) {
      const into = historyDir(board.id)
      fs.mkdirSync(into, { recursive: true })
      const sibling = new AssetStore(assetsDir)
      for (const f of fs.readdirSync(hdir)) {
        try {
          const bytes = fs.readFileSync(path.join(hdir, f))
          decodeContainer(bytes, f)
          for (const a of readHeader(bytes).header.assets ?? []) {
            const m = a.match(ASSET_FILE_RE)
            if (m && !board.store.has(m[1], m[2]) && sibling.has(m[1], m[2])) board.store.importFile(sibling.file(m[1], m[2]), m[2], m[1])
          }
          fs.copyFileSync(path.join(hdir, f), path.join(into, f))
          history++
        } catch {
          warnings.push(`Version ${f} couldn’t be read and was left out`)
        }
      }
    }

    const result: ImportResult['skills'] = { installed: [], available: [], skipped: [] }
    const sdir = path.join(staging, 'skills')
    if (fs.existsSync(sdir)) {
      for (const n of fs.readdirSync(sdir)) {
        const dir = path.join(sdir, n)
        const s = loadSkill(dir, 'user')
        const have = skills.get(s.name)
        if (s.errors.length) result.skipped.push({ name: n, reason: s.errors[0] })
        else if (s.name !== n) result.skipped.push({ name: n, reason: 'its folder name doesn’t match the skill name' })
        else if (have?.source === 'builtin') result.skipped.push({ name: n, reason: 'built in already' })
        else if (have && have.version === s.version) result.skipped.push({ name: n, reason: 'installed already' })
        else if (!opts.installSkills) result.available.push(n)
        else {
          const r = skills.install(dir)
          if (r.errors.length) result.skipped.push({ name: n, reason: r.errors[0] })
          else result.installed.push(n)
        }
      }
    }
    return { board, path: boardFile, manifest, history, skills: result, warnings }
  } finally {
    fs.closeSync(fd)
    fs.rmSync(staging, { recursive: true, force: true })
  }
}

