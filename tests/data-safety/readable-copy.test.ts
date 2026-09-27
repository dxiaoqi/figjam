import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { Board, BoardRegistry } from '../../packages/core/src/board'
import { readableCopies } from '../../packages/core/src/readable-copy'
import { sticky, tempHome } from './helpers'

const fill = (b: Board, n: number) =>
  b.doc.transact(() => {
    for (let i = 0; i < n; i++) b.blocks.set(`s${i}`, sticky(`s${i}`, `note ${i}`, { x: (i % 100) * 240, y: Math.floor(i / 100) * 240 }))
    b.assets.set('img', { id: 'img', hash: '0'.repeat(64), ext: 'png', mime: 'image/png', size: 3, role: 'image', w: 1, h: 1, createdAt: 1 })
  })

const readJson = (b: Board) => JSON.parse(fs.readFileSync(b.jsonFile, 'utf8'))

test('the readable copy is built in the background, debounced, with the same shape as Board.toJSON()', async () => {
  delete process.env.AIFIG_JSON_COPY
  tempHome('readable')
  const b = Board.create('Readable')
  fill(b, 50)
  b.saveNow()
  assert.ok(!fs.existsSync(b.jsonFile) || readJson(b).blocks.length === 0, 'saveNow does not write the copy inline')
  await readableCopies.idle()
  assert.deepEqual(readJson(b), JSON.parse(JSON.stringify(b.toJSON())))
  assert.equal(readJson(b).assets[0].size, 3)
  const st = readableCopies.status()
  assert.ok(st.written.worker > 0 && st.workerError === null, `built by the worker thread: ${JSON.stringify(st)}`)

  b.doc.transact(() => b.blocks.delete('s0'))
  b.saveNow()
  b.doc.transact(() => b.blocks.delete('s1'))
  b.saveNow()
  await readableCopies.idle()
  assert.equal(readJson(b).blocks.length, 48, 'the latest save wins')
})

test('saving a 10k-block board keeps the main thread free of the readable copy', async () => {
  delete process.env.AIFIG_JSON_COPY
  tempHome('readable-10k')
  const b = Board.create('Big')
  fill(b, 10_000)
  const t0 = performance.now()
  b.saveNow()
  const saveMs = performance.now() - t0
  await readableCopies.idle()
  assert.equal(readJson(b).blocks.length, 10_000)
  process.env.AIFIG_JSON_COPY = 'sync'
  b.doc.transact(() => b.blocks.delete('s0'))
  b.saveNow()
  const t1 = performance.now()
  await readableCopies.idle()
  const inlineMs = performance.now() - t1
  delete process.env.AIFIG_JSON_COPY
  assert.ok(saveMs < inlineMs + 40, `save ${saveMs.toFixed(1)} ms vs building the copy inline ${inlineMs.toFixed(1)} ms`)
})

test('flush on exit writes pending copies synchronously; deleting a board removes its copy', async () => {
  delete process.env.AIFIG_JSON_COPY
  tempHome('readable-flush')
  const reg = new BoardRegistry()
  const b = reg.create('Flushed')
  fill(b, 10)
  reg.flush()
  assert.equal(readJson(b).blocks.length, 10, 'flush() leaves an up-to-date copy')
  const file = b.jsonFile
  reg.delete(b.id)
  await readableCopies.idle()
  assert.ok(!fs.existsSync(file))
})

test('AIFIG_JSON_COPY=off skips the readable copy', async () => {
  process.env.AIFIG_JSON_COPY = 'off'
  tempHome('readable-off')
  const b = Board.create('No copy')
  fill(b, 5)
  b.saveNow()
  await readableCopies.idle()
  assert.ok(!fs.existsSync(b.jsonFile))
  delete process.env.AIFIG_JSON_COPY
})
