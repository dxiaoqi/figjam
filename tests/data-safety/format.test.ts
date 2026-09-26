import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as Y from 'yjs'
import { CorruptFileError, CURRENT_SCHEMA, decodeContainer, encodeContainer, FutureVersionError, isContainer, MAGIC } from '../../packages/core/src/fileformat'
import { migrate, type Migration } from '../../packages/core/src/migrations'
import { selectPrunable } from '../../packages/core/src/versions'

function docBytes(n = 3) {
  const d = new Y.Doc()
  d.getMap('meta').set('title', 'Format test')
  for (let i = 0; i < n; i++) d.getMap('blocks').set(`b${i}`, { id: `b${i}`, text: 'x'.repeat(50) })
  return Y.encodeStateAsUpdate(d)
}

test('container round-trips and records the schema version', () => {
  const payload = docBytes()
  const file = encodeContainer(payload, { savedAt: 123, board: 'b1', title: 'T' })
  assert.ok(isContainer(file))
  assert.ok(file.subarray(0, MAGIC.length).equals(MAGIC))
  const d = decodeContainer(file)
  assert.deepEqual(d.schema, CURRENT_SCHEMA)
  assert.equal(d.header?.schema, '1.0')
  assert.equal(d.header?.board, 'b1')
  assert.deepEqual(Buffer.from(d.payload), Buffer.from(payload))
})

test('a truncated file is detected, wherever it was cut', () => {
  const file = encodeContainer(docBytes(20), { savedAt: 1 })
  for (const cut of [3, 8, 20, file.length - 200, file.length - 1]) {
    assert.throws(() => decodeContainer(file.subarray(0, cut)), (e: unknown) => e instanceof CorruptFileError && /truncated|not an ai-figma/.test(e.reason), `cut at ${cut}`)
  }
})

test('a flipped byte in the payload fails the checksum', () => {
  const file = Buffer.from(encodeContainer(docBytes(), { savedAt: 1 }))
  file[file.length - 10] ^= 0xff
  assert.throws(() => decodeContainer(file), (e: unknown) => e instanceof CorruptFileError && e.reason.includes('checksum'))
})

test('an empty file is corrupt, not an empty board', () => {
  assert.throws(() => decodeContainer(new Uint8Array()), CorruptFileError)
})

test('a file from a newer major version is refused with a clear message', () => {
  const file = encodeContainer(docBytes(), { savedAt: 1, schema: '2.0' })
  assert.throws(
    () => decodeContainer(file),
    (e: unknown) => e instanceof FutureVersionError && e.schema === '2.0' && /newer version of ai-figma/.test(e.message) && /Update ai-figma/.test(e.message) && /has not been changed/.test(e.message),
  )
})

test('a newer minor version of the current major opens', () => {
  const file = encodeContainer(docBytes(), { savedAt: 1, schema: `${CURRENT_SCHEMA.major}.7` })
  const d = decodeContainer(file)
  assert.deepEqual(d.schema, { major: CURRENT_SCHEMA.major, minor: 7 })
  const doc = new Y.Doc()
  Y.applyUpdate(doc, d.payload)
  const r = migrate(doc, d.schema)
  assert.equal(r.newerMinor, true)
  assert.deepEqual(r.applied, [])
})

test('files without the magic are schema 0 (bare Yjs updates)', () => {
  const d = decodeContainer(docBytes())
  assert.deepEqual(d.schema, { major: 0, minor: 0 })
  assert.equal(d.header, null)
})

test('migration 0.0 → 1.0 stamps the schema and fills missing metadata', () => {
  const doc = new Y.Doc()
  doc.getMap('meta').set('format', 'aifig/0')
  doc.getMap('blocks').set('a', { id: 'a', createdAt: 5000 })
  const r = migrate(doc, { major: 0, minor: 0 })
  assert.equal(r.applied.length, 1)
  const meta = doc.getMap('meta')
  assert.equal(meta.get('schema'), '1.0')
  assert.equal(meta.get('format'), undefined)
  assert.equal(meta.get('createdAt'), 5000)
  assert.equal(meta.get('title'), 'Untitled board')
})

test('the migration framework chains forward steps in order', () => {
  const log: string[] = []
  const steps: Migration[] = [
    { from: { major: 1, minor: 1 }, to: { major: 2, minor: 0 }, description: 'split', up: (d) => (log.push('1.1→2.0'), d.getMap('meta').set('split', true)) },
    { from: { major: 1, minor: 0 }, to: { major: 1, minor: 1 }, description: 'add', up: (d) => (log.push('1.0→1.1'), d.getMap('meta').set('added', true)) },
  ]
  const doc = new Y.Doc()
  const r = migrate(doc, { major: 1, minor: 0 }, steps, { major: 2, minor: 0 })
  assert.deepEqual(log, ['1.0→1.1', '1.1→2.0'])
  assert.deepEqual(r.to, { major: 2, minor: 0 })
  assert.equal(doc.getMap('meta').get('schema'), '2.0')
  assert.equal(doc.getMap('meta').get('split'), true)
})

test('migrations run in one transaction (one update for listeners)', () => {
  const steps: Migration[] = [
    { from: { major: 1, minor: 0 }, to: { major: 1, minor: 1 }, description: 'a', up: (d) => d.getMap('meta').set('a', 1) },
    { from: { major: 1, minor: 1 }, to: { major: 1, minor: 2 }, description: 'b', up: (d) => d.getMap('meta').set('b', 2) },
  ]
  const doc = new Y.Doc()
  let updates = 0
  doc.on('update', () => updates++)
  migrate(doc, { major: 1, minor: 0 }, steps, { major: 1, minor: 2 })
  assert.equal(updates, 1)
})

test('a gap in the migration chain is an error, not a silent skip', () => {
  const steps: Migration[] = [{ from: { major: 1, minor: 0 }, to: { major: 1, minor: 1 }, description: 'a', up: () => {} }]
  assert.throws(() => migrate(new Y.Doc(), { major: 1, minor: 0 }, steps, { major: 1, minor: 3 }), /No migration from file format 1.1/)
})

test('migrate refuses a newer major version', () => {
  assert.throws(() => migrate(new Y.Doc(), { major: 9, minor: 0 }), FutureVersionError)
})

test('retention keeps recent versions, then hourly, then daily, and never checkpoints', () => {
  const H = 3_600_000
  const now = 1_800_000_000_000
  const versions = [
    ...Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, kind: 'auto' as const, createdAt: now - i * 60_000 })),
    // hours 1–3 ago: two per hour → one survives per hour (plus those in keepRecent)
    ...[1, 1.2, 2, 2.2, 3, 3.2].map((h, i) => ({ id: `h${i}`, kind: 'auto' as const, createdAt: now - h * H - 40 * 60_000 })),
    // days 5 and 6 ago: two each → one survives per day
    ...[5, 5.1, 6, 6.1].map((d, i) => ({ id: `d${i}`, kind: 'auto' as const, createdAt: now - d * 24 * H })),
    { id: 'ancient', kind: 'auto' as const, createdAt: now - 90 * 24 * H },
    { id: 'named', kind: 'checkpoint' as const, createdAt: now - 400 * 24 * H },
    { id: 'rescued', kind: 'recovered' as const, createdAt: now - 400 * 24 * H },
  ]
  const doomed = new Set(selectPrunable(versions, { keepRecent: 20, hourlyForHours: 48, dailyForDays: 30 }, now))
  for (let i = 0; i < 20; i++) assert.ok(!doomed.has(`r${i}`), `r${i} is recent`)
  assert.ok(doomed.has('ancient'))
  assert.ok(!doomed.has('named') && !doomed.has('rescued'))
  const keptHourly = ['h0', 'h1', 'h2', 'h3', 'h4', 'h5'].filter((id) => !doomed.has(id))
  assert.equal(keptHourly.length, 3)
  assert.equal(['d0', 'd1', 'd2', 'd3'].filter((id) => !doomed.has(id)).length, 2)
})
