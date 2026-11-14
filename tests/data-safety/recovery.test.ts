import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import * as Y from 'yjs'
import { listBackups } from '../../packages/core/src/backups'
import { Board, BoardRegistry, boardsDir } from '../../packages/core/src/board'
import { decodeContainer, encodeContainer, isContainer } from '../../packages/core/src/fileformat'
import { listVersions } from '../../packages/core/src/versions'
import { sticky, tempHome } from './helpers'

function boardWith(n: number, title = 'Recovery board') {
  const reg = new BoardRegistry()
  const b = reg.create(title)
  b.doc.transact(() => {
    for (let i = 0; i < n; i++) b.blocks.set(`s${i}`, sticky(`s${i}`))
  })
  b.saveNow()
  return { reg, b }
}

function reload() {
  const reg = new BoardRegistry()
  reg.loadAll()
  return reg
}

test('saves are checksummed containers, written atomically (no temp files left)', () => {
  tempHome()
  const { b } = boardWith(4)
  const bytes = fs.readFileSync(b.file)
  assert.ok(isContainer(bytes))
  assert.equal(decodeContainer(bytes).header?.board, b.id)
  assert.deepEqual(
    fs.readdirSync(boardsDir()).filter((f) => f.includes('.tmp')),
    [],
  )
})

test('edits are coalesced: a burst of changes is one write, and the deadline caps the wait', async () => {
  tempHome()
  const { b } = boardWith(0)
  let writes = 0
  const orig = b.onSaved
  b.onSaved = (x) => (writes++, orig?.(x))
  const start = Date.now()
  // edit every 100ms for ~2.6s: the 250ms debounce alone would never fire
  while (Date.now() - start < 2600) {
    b.blocks.set(`k${Date.now()}`, sticky('k'))
    await new Promise((r) => setTimeout(r, 100))
  }
  assert.ok(writes >= 1 && writes <= 2, `${writes} writes for ~26 edits`)
  b.saveNow()
})

test('a truncated board file is restored from the newest good version and the person is told', () => {
  const home = tempHome()
  const { reg, b } = boardWith(6)
  reg.safety.snapshot(b, 'checkpoint', 'Six stickies')
  const full = fs.readFileSync(b.file)
  fs.writeFileSync(b.file, full.subarray(0, Math.floor(full.length / 2)))

  const reg2 = reload()
  const back = reg2.get(b.id)
  assert.ok(back, 'board is loaded, not dropped')
  assert.equal(back!.blocks.size, 6, 'content comes back from the version')
  const n = reg2.notices.list(b.id)
  assert.equal(n[0]?.kind, 'recovered')
  assert.match(n[0].detail, /truncated/)
  assert.ok(n[0].file && fs.existsSync(n[0].file), 'the damaged file is kept')
  assert.ok(n[0].file!.startsWith(path.join(home, 'backups', 'damaged')))
  assert.ok(isContainer(fs.readFileSync(back!.file)), 'a good file is written back')
  assert.ok(listVersions(b.id).some((v) => v.kind === 'recovered'))
})

test('recovery prefers the newest good copy (a backup newer than the last version)', () => {
  tempHome()
  const { reg, b } = boardWith(2)
  reg.safety.snapshot(b, 'auto', 'old')
  b.blocks.set('late', sticky('late'))
  b.saveNow()
  // a backup taken after the version
  const dir = path.join(process.env.NODBOARD_HOME!, 'backups', `recovery-board--${b.id}`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, '2999-01-01_000000.nodboard'), encodeContainer(Y.encodeStateAsUpdate(b.doc), { savedAt: Date.now() + 5000, board: b.id }))
  fs.writeFileSync(b.file, Buffer.from('garbage that is not a board'))
  const back = reload().get(b.id)
  assert.equal(back?.blocks.size, 3)
})

test('with no good copy anywhere the board is not replaced by an empty one — it is reported', () => {
  tempHome()
  const { b } = boardWith(3)
  for (const d of [path.join(process.env.NODBOARD_HOME!, 'history'), path.join(process.env.NODBOARD_HOME!, 'backups')]) fs.rmSync(d, { recursive: true, force: true })
  fs.writeFileSync(b.file, fs.readFileSync(b.file).subarray(0, 40))
  const reg2 = reload()
  assert.equal(reg2.get(b.id), undefined)
  const n = reg2.notices.list().find((x) => x.boardId === b.id)
  assert.equal(n?.kind, 'unreadable')
  assert.equal(n?.level, 'error')
  assert.ok(n?.file && fs.existsSync(n.file), 'the damaged bytes are kept aside')
  assert.ok(!fs.existsSync(b.file))
})

test('a board file from a future version is refused, reported, and left untouched', () => {
  tempHome()
  const { b } = boardWith(2)
  const future = encodeContainer(Y.encodeStateAsUpdate(b.doc), { savedAt: Date.now(), board: b.id, schema: '3.0' })
  fs.writeFileSync(b.file, future)
  const reg2 = reload()
  assert.equal(reg2.get(b.id), undefined)
  const n = reg2.notices.list().find((x) => x.boardId === b.id)
  assert.equal(n?.kind, 'future-version')
  assert.match(n!.detail, /newer version of nodboard.*format 3\.0/)
  assert.ok(fs.readFileSync(b.file).equals(future), 'file bytes unchanged')
  reg2.flush()
  assert.ok(fs.readFileSync(b.file).equals(future), 'still unchanged after a flush')
})

test('a legacy (schema 0) file is migrated, with a backup of the original', () => {
  tempHome()
  fs.mkdirSync(boardsDir(), { recursive: true })
  const d = new Y.Doc()
  d.getMap('meta').set('title', 'Old board')
  d.getMap('meta').set('format', 'nodboard/0')
  d.getMap('blocks').set('a', sticky('a'))
  const legacy = Buffer.from(Y.encodeStateAsUpdate(d))
  const file = path.join(boardsDir(), 'blegacy01.nodboard')
  fs.writeFileSync(file, legacy)
  const reg = reload()
  const b = reg.get('blegacy01')
  assert.equal(b?.blocks.size, 1)
  assert.equal(b?.meta.get('schema'), '2.0')
  assert.ok(isContainer(fs.readFileSync(file)), 'rewritten in the current format')
  const pre = listBackups('blegacy01').find((x) => x.file.includes('before-format-0.0'))
  assert.ok(pre && fs.readFileSync(pre.file).equals(legacy), 'original bytes kept in backups')
})

test('opening a future-version file from disk fails with a clear message', () => {
  tempHome()
  const reg = new BoardRegistry()
  const f = path.join(process.env.NODBOARD_HOME!, 'from-the-future.nodboard')
  fs.writeFileSync(f, encodeContainer(Y.encodeStateAsUpdate(new Y.Doc()), { savedAt: 1, schema: '3.1' }))
  assert.throws(() => reg.openFile(f), /newer version of nodboard.*3\.1/)
})

test('large edits keep the state from just before them as a version', () => {
  tempHome()
  const { b } = boardWith(30)
  b.doc.transact(() => {
    for (let i = 0; i < 12; i++) b.blocks.delete(`s${i}`)
  })
  b.saveNow()
  const v = listVersions(b.id).find((x) => x.name.includes('removed'))
  assert.ok(v, JSON.stringify(listVersions(b.id).map((x) => x.name)))
  assert.equal(v!.name, 'Before 12 items were removed')
  assert.equal(v!.blockCount, 30)
})

test('backups respect NODBOARD_BACKUP_DIR and keep a final copy of a deleted board', () => {
  const home = tempHome()
  process.env.NODBOARD_BACKUP_DIR = path.join(home, 'elsewhere')
  try {
    const { reg, b } = boardWith(1, 'Doomed')
    reg.delete(b.id)
    const bk = listBackups(b.id)
    assert.ok(bk.some((x) => x.file.startsWith(path.join(home, 'elsewhere')) && x.file.includes('deleted')))
    assert.ok(Board.fromBytes(b.id, fs.readFileSync(bk[0].file), undefined, { persist: false }).board.blocks.size === 1)
  } finally {
    delete process.env.NODBOARD_BACKUP_DIR
  }
})
