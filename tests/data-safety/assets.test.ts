import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import * as Y from 'yjs'
import { assetFileName, snippetThumbKey, type Asset, type Block } from '../../packages/shared/src'
import { AssetStore, sha256Hex, siblingAssetsDir } from '../../packages/core/src/assets'
import { backupPools, listBackups } from '../../packages/core/src/backups'
import { Board, BoardRegistry, boardsDir } from '../../packages/core/src/board'
import { decodeContainer, encodeContainer, readHeader } from '../../packages/core/src/fileformat'
import { cleanUpAssets, collectBoardAssets, storageInfo, unusedEntries } from '../../packages/core/src/storage'
import { deleteVersion, historyDir, listVersions, readVersion } from '../../packages/core/src/versions'
import { sticky, tempHome } from './helpers'

/** A tiny valid PNG of `n` bytes-ish (distinct per seed). */
function png(seed: number, pad = 0) {
  const head = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
  const wh = Buffer.alloc(8)
  wh.writeUInt32BE(4 + seed, 0)
  wh.writeUInt32BE(3, 4)
  return new Uint8Array(Buffer.concat([head, wh, Buffer.alloc(16 + pad, seed)]))
}

const imageBlock = (id: string, asset: string): Block => ({ ...sticky(id), kind: 'image', asset, text: '', color: 'gray' }) as Block

/** A schema 1.0 board file as older builds wrote it: image bytes and snippet source inside the document. */
function legacyBoard(id: string, opts: { big?: number } = {}) {
  const d = new Y.Doc()
  d.getMap('meta').set('title', 'Legacy board')
  d.getMap('meta').set('schema', '1.0')
  const bytes = png(1, opts.big ?? 0)
  d.getMap('assets').set('aold1', { id: 'aold1', mime: 'image/png', w: 5, h: 3, bytes, name: 'sketch.png', createdAt: 1 })
  d.getMap('assets').set('aold2', { id: 'aold2', mime: 'image/png', w: 5, h: 3, bytes, name: 'same-bytes.png', createdAt: 1 })
  d.getMap('blocks').set('img', imageBlock('img', 'aold1'))
  d.getMap('blocks').set('img2', imageBlock('img2', 'aold2'))
  const web = { mode: 'inline' as const, html: '<h1>Counter</h1><button id=b>+1</button>', css: 'h1{color:teal}', js: 'b.onclick=()=>b.textContent++', title: 'Counter' }
  const thumbFor = snippetThumbKey(web)
  d.getMap('blocks').set('web', { ...sticky('web'), kind: 'web', w: 480, h: 320, text: 'Counter', web: { ...web, thumb: 'aold1', thumbFor } })
  // a pending agent edit whose `before` still holds the old inline source
  d.getMap('changeSets').set('cs1', {
    id: 'cs1',
    author: { kind: 'agent', id: 'a', name: 'Agent' },
    intent: 'tweak',
    status: 'pending',
    entries: [{ op: 'update', target: 'block', id: 'web', before: { ...sticky('web'), kind: 'web', web: { mode: 'inline', html: '<p>before</p>', js: '' } } }],
    createdAt: 1,
    updatedAt: 1,
  })
  const file = encodeContainer(Y.encodeStateAsUpdate(d), { savedAt: Date.now() - 60_000, board: id, title: 'Legacy board', schema: '1.0' })
  return { file, bytes, web }
}

test('content-addressed store: identical bytes are one read-only file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aifig-store-'))
  const s = new AssetStore(dir)
  const a = s.put(png(7), 'png')
  const b = s.put(png(7), 'png')
  assert.equal(a.hash, b.hash)
  assert.equal(a.added, true)
  assert.equal(b.added, false)
  assert.equal(s.list().length, 1)
  assert.equal(path.basename(a.file), `${sha256Hex(png(7))}.png`)
  if (process.platform !== 'win32') assert.equal(fs.statSync(a.file).mode & 0o222, 0, 'asset files are read-only')
  assert.ok(s.verify(a.hash, 'png'))
})

test('a 1.0 board migrates forward: files out of the document, snippet source as files, backup of the original', () => {
  tempHome()
  fs.mkdirSync(boardsDir(), { recursive: true })
  const { file, bytes, web } = legacyBoard('blegacy', { big: 200_000 })
  const boardFile = path.join(boardsDir(), 'blegacy.aifig')
  fs.writeFileSync(boardFile, file)
  // an old version with the same image embedded
  fs.mkdirSync(historyDir('blegacy'), { recursive: true })
  const vfile = path.join(historyDir('blegacy'), 'vold1.aifig')
  const vdoc = new Y.Doc()
  Y.applyUpdate(vdoc, decodeContainer(file).payload)
  fs.writeFileSync(vfile, encodeContainer(Y.encodeStateAsUpdate(vdoc), { savedAt: 1000, board: 'blegacy', schema: '1.0', version: { id: 'vold1', kind: 'checkpoint', name: 'Old', createdAt: 1000 } }))
  const oldVersionSize = fs.statSync(vfile).size

  const reg = new BoardRegistry()
  reg.loadAll()
  const b = reg.get('blegacy')!
  assert.ok(b)
  assert.equal(b.schemaLabel, '2.0')
  const a1 = b.assets.get('aold1') as Asset
  assert.equal(a1.hash, sha256Hex(bytes))
  assert.equal(a1.size, bytes.byteLength)
  assert.equal(a1.role, 'preview', 'used as a snippet preview')
  assert.equal((a1 as unknown as { bytes?: unknown }).bytes, undefined, 'no bytes left in the document')
  assert.equal(b.store.list().filter((f) => f.ext === 'png').length, 1, 'two entries with the same bytes share one file')
  assert.deepEqual(new Uint8Array(b.readAsset('aold2')!), bytes)

  const w = b.blocks.get('web')!.web!
  assert.equal(w.html, undefined)
  assert.ok(w.src?.html && w.src.css && w.src.js)
  assert.deepEqual(b.snippetSource(w), { html: web.html, css: web.css, js: web.js })
  assert.equal(w.thumbFor, snippetThumbKey(w), 'the preview stays valid for the migrated source')
  const before = b.changeSets.get('cs1')!.entries[0] as { before: Block }
  assert.equal(before.before.web?.html, undefined)
  assert.equal(b.snippetSource(before.before.web).html, '<p>before</p>', 'pending review still reverts to the right source')

  const onDisk = fs.readFileSync(boardFile)
  const { header } = readHeader(onDisk)
  assert.equal(header.schema, '2.0')
  assert.ok(header.assets?.includes(assetFileName(a1)))
  assert.ok(onDisk.byteLength < 20_000, `the board file no longer carries the image (${onDisk.byteLength} bytes)`)

  const pre = listBackups('blegacy').find((x) => x.file.includes('before-format-1.0'))
  assert.ok(pre && fs.readFileSync(pre.file).equals(file), 'the original 1.0 file is kept byte for byte')

  const v = readVersion('blegacy', 'vold1')
  assert.equal(v.header?.schema, '2.0', 'history is migrated too')
  assert.ok(v.header?.assets?.includes(assetFileName(a1)))
  assert.ok(fs.statSync(vfile).size < oldVersionSize / 4, 'the version no longer embeds the image')
  assert.equal(listVersions('blegacy').find((x) => x.id === 'vold1')?.name, 'Old')
})

test('history and backups reference files instead of copying them', () => {
  tempHome()
  const reg = new BoardRegistry()
  reg.loadAll()
  const b = reg.create('Refs')
  const big = png(3, 300_000)
  b.doc.transact(() => {
    const a = b.putAsset(big, { mime: 'image/png', ext: 'png', role: 'image', name: 'big.png', w: 7, h: 3 })
    b.blocks.set('i', imageBlock('i', a.id))
  })
  b.saveNow(true)
  for (let i = 0; i < 5; i++) {
    b.doc.transact(() => b.blocks.set(`s${i}`, sticky(`s${i}`)))
    b.saveNow(true)
    reg.safety.snapshot(b, 'checkpoint', `v${i}`)
  }
  const versions = listVersions(b.id).filter((v) => v.kind === 'checkpoint')
  assert.equal(versions.length, 5)
  for (const v of versions) assert.ok(v.size < 20_000, `version ${v.name} is ${v.size} bytes`)
  reg.safety.onLoaded(b, fs.readFileSync(b.file))
  const pools = backupPools(b.id).map((d) => new AssetStore(d))
  assert.equal(pools.length, 1)
  assert.equal(pools[0].list().length, 1, 'backups share one pooled copy')
  assert.ok(listBackups(b.id).every((x) => fs.statSync(x.file).size < 20_000))
})

test('garbage collection never deletes a file a version, a pending change or the board still names', () => {
  tempHome()
  const reg = new BoardRegistry()
  reg.loadAll()
  const b = reg.create('GC')
  let keep!: Asset, history!: Asset, pending!: Asset, orphan!: Asset
  b.doc.transact(() => {
    keep = b.putAsset(png(10), { mime: 'image/png', ext: 'png', role: 'image' })
    history = b.putAsset(png(11), { mime: 'image/png', ext: 'png', role: 'image' })
    pending = b.putAsset(png(12), { mime: 'image/png', ext: 'png', role: 'image' })
    b.blocks.set('k', imageBlock('k', keep.id))
    b.blocks.set('h', imageBlock('h', history.id))
    b.blocks.set('p', imageBlock('p', pending.id))
  })
  b.saveNow(true)
  const v = reg.safety.snapshot(b, 'checkpoint', 'has the history image')
  b.doc.transact(() => {
    // uploaded after the version, never placed
    orphan = b.putAsset(png(13), { mime: 'image/png', ext: 'png', role: 'image' })
    b.blocks.delete('h')
    // an agent replaced p's image; the change is waiting for review and its `before` names the old file
    const before = b.blocks.get('p')!
    b.blocks.set('p', { ...before, asset: keep.id, pending: true, changeSet: 'cs' })
    b.changeSets.set('cs', { id: 'cs', author: { kind: 'agent', id: 'x', name: 'X' }, intent: 'swap', status: 'pending', entries: [{ op: 'update', target: 'block', id: 'p', before }], createdAt: 1, updatedAt: 1 })
  })
  b.saveNow(true)
  // pretend the files are old enough to collect
  for (const f of b.store.list()) fs.utimesSync(f.file, new Date(0), new Date(0))

  assert.deepEqual(unusedEntries(b).map((a) => a.id).sort(), [history.id, orphan.id].sort())
  const dry = cleanUpAssets(b, { dryRun: true })
  assert.equal(dry.deleted.length, 1)
  assert.equal(b.assets.size, 4, 'a dry run changes nothing')
  const r = cleanUpAssets(b)
  assert.deepEqual(r.removedEntries.map((e) => e.id).sort(), [history.id, orphan.id].sort())
  assert.deepEqual(r.deleted.map((d) => d.name), [assetFileName(orphan)], 'only the file nothing names is deleted')
  assert.equal(r.keptForHistory, 1)
  assert.ok(b.store.has(history.hash, 'png'), 'the version still has its image')
  assert.ok(b.store.has(pending.hash, 'png'), 'rejecting the pending change can still bring the old image back')

  // a damaged version header: collection stops rather than guess
  const bad = path.join(historyDir(b.id), 'vbroken.aifig')
  fs.writeFileSync(bad, Buffer.from('AIFIG\0garbage'))
  assert.ok(listVersions(b.id).length >= 2, 'the first save made an automatic version too')
  for (const x of listVersions(b.id)) deleteVersion(b.id, x.id)
  assert.ok(v.id)
  assert.match(collectBoardAssets(b, { graceMs: 0 }).skipped ?? '', /can’t be read/)
  assert.ok(b.store.has(history.hash, 'png'))
  fs.rmSync(bad)
  const r2 = collectBoardAssets(b, { graceMs: 0 })
  assert.deepEqual(r2.deleted.map((d) => d.name), [assetFileName(history)], 'once no version names it, it goes')

  // young files are spared by automatic collection (something may be about to refer to them)
  b.store.put(png(99), 'png')
  assert.equal(collectBoardAssets(b).deleted.length, 0)
})

test('Save As mirrors files to Name.assets; the moved pair opens elsewhere; tampered files are refused', () => {
  const home = tempHome()
  const reg = new BoardRegistry()
  reg.loadAll()
  const b = reg.create('Portable')
  const bytes = png(21, 1000)
  b.doc.transact(() => {
    const a = b.putAsset(bytes, { mime: 'image/png', ext: 'png', role: 'image', name: 'photo.png' })
    b.blocks.set('i', imageBlock('i', a.id))
  })
  const docs = path.join(home, 'Documents')
  fs.mkdirSync(docs)
  const target = path.join(docs, 'Portable.aifig')
  reg.saveAs(b, target)
  const sibling = siblingAssetsDir(target)
  assert.equal(path.basename(sibling), 'Portable.assets')
  const name = `${sha256Hex(bytes)}.png`
  assert.ok(fs.existsSync(path.join(sibling, name)), 'Save As writes the files next to the board')

  // move both to another folder (another machine: a fresh AIFIG_HOME)
  const moved = path.join(home, 'Moved')
  fs.mkdirSync(moved)
  fs.copyFileSync(target, path.join(moved, 'Renamed.aifig'))
  fs.mkdirSync(path.join(moved, 'Renamed.assets'))
  fs.copyFileSync(path.join(sibling, name), path.join(moved, 'Renamed.assets', name))
  tempHome()
  const reg2 = new BoardRegistry()
  reg2.loadAll()
  const opened = reg2.openFile(path.join(moved, 'Renamed.aifig'))
  assert.deepEqual(new Uint8Array(opened.readAsset(opened.blocks.get('i')!.asset)!), bytes)
  assert.ok(opened.store.has(sha256Hex(bytes), 'png'))

  // a file whose bytes don't match its name is not taken in
  const evil = path.join(home, 'Evil')
  fs.mkdirSync(path.join(evil, 'Evil.assets'), { recursive: true })
  fs.copyFileSync(target, path.join(evil, 'Evil.aifig'))
  fs.writeFileSync(path.join(evil, 'Evil.assets', name), Buffer.from('not the image'))
  tempHome()
  const reg3 = new BoardRegistry()
  reg3.loadAll()
  const e = reg3.openFile(path.join(evil, 'Evil.aifig'))
  assert.equal(e.store.has(sha256Hex(bytes), 'png'), false)
  assert.equal(storageInfo(e).assets[0].status, 'missing')
})

test('storage info lists files, users, history and backups', () => {
  tempHome()
  const reg = new BoardRegistry()
  reg.loadAll()
  const b = reg.create('Info')
  b.doc.transact(() => {
    const a = b.putAsset(png(31), { mime: 'image/png', ext: 'png', role: 'image', name: 'x.png' })
    b.blocks.set('i', imageBlock('i', a.id))
    b.blocks.set('j', imageBlock('j', a.id))
  })
  b.saveNow(true)
  const info = storageInfo(b)
  assert.equal(info.assets.length, 1)
  assert.equal(info.assets[0].usedBy.length, 2)
  assert.equal(info.assets[0].status, 'used')
  assert.equal(info.totals.assetFiles, 1)
  assert.ok(info.totals.total > info.totals.boardFile)
  assert.ok(info.history.dir.includes(b.id))
  assert.ok(info.backups.dir.includes(b.id))
})

test('deleting a board keeps its last backup complete (the pool has its files)', () => {
  tempHome()
  const reg = new BoardRegistry()
  reg.loadAll()
  const b = reg.create('Doomed')
  const bytes = png(41)
  b.doc.transact(() => {
    const a = b.putAsset(bytes, { mime: 'image/png', ext: 'png', role: 'image' })
    b.blocks.set('i', imageBlock('i', a.id))
  })
  b.saveNow(true)
  const id = b.id
  reg.delete(id)
  assert.ok(!fs.existsSync(path.join(boardsDir(), `${id}.assets`)))
  const last = listBackups(id).find((x) => x.file.includes('deleted'))!
  assert.ok(last)
  const pool = new AssetStore(backupPools(id)[0])
  assert.ok(pool.has(sha256Hex(bytes), 'png'))
  // and it opens from Open… with its image
  const reg2 = new BoardRegistry()
  reg2.loadAll()
  const restored = reg2.importCopy(last.file)
  assert.deepEqual(new Uint8Array(restored.readAsset(restored.blocks.get('i')!.asset)!), bytes)
})

test('Board.fromBytes of a version preview never writes to the board file', () => {
  tempHome()
  const { file } = legacyBoard('bprev')
  const { board } = Board.fromBytes('bprev', file, undefined, { persist: false })
  board.saveNow(true)
  assert.ok(!fs.existsSync(board.file))
})

test('adding a file from disk copies it: the person’s file stays writable and separate', () => {
  const home = tempHome()
  const reg = new BoardRegistry()
  reg.loadAll()
  const b = reg.create('Own file')
  const mine = path.join(home, 'clip.bin')
  fs.writeFileSync(mine, png(51, 5000))
  const a = b.importAssetFile(mine, { mime: 'image/png', ext: 'png', role: 'image' })
  const stored = b.assetPath(a)!
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(mine).nlink, 1, 'not hard-linked to the store')
    assert.notEqual(fs.statSync(mine).mode & 0o200, 0, 'still writable')
  }
  fs.appendFileSync(mine, 'edited later')
  assert.ok(b.store.verify(a.hash, 'png'), `the stored copy is unaffected (${stored})`)
})
