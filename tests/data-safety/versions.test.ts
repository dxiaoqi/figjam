import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CanvasCore } from '../../packages/core/src/api'
import { tempHome } from './helpers'

const HUMAN = { id: 'human:test', name: 'You', client: 'test', kind: 'human' as const }
const AGENT = { id: 'agent:test:1', name: 'Test Bot', client: 'test', kind: 'agent' as const }

async function setup() {
  tempHome('versions')
  const core = new CanvasCore()
  core.init()
  const call = async (caller: typeof HUMAN | typeof AGENT, tool: string, args: Record<string, unknown> = {}) => {
    const r = await core.call({ tool: tool as any, args, caller })
    if (!r.ok) throw new Error(r.error)
    return r.result as any
  }
  const board = (await call(HUMAN, 'create_board', { title: 'History' })).board.id
  return { core, call, board }
}

test('checkpoint → edit → restore brings the board back, and the restore can itself be undone', async () => {
  const { call, board } = await setup()
  const made = await call(HUMAN, 'create_blocks', { board, blocks: [{ text: 'one' }, { text: 'two' }, { text: 'three' }] })
  const cp = (await call(HUMAN, 'create_version', { board, name: 'Three ideas' })).version
  assert.equal(cp.kind, 'checkpoint')
  assert.equal(cp.blockCount, 3)

  await call(HUMAN, 'delete_blocks', { board, ids: [made.created[0].id, made.created[1].id] })
  await call(HUMAN, 'create_blocks', { board, blocks: [{ text: 'four' }] })
  const texts = async () => (await call(HUMAN, 'get_board', { board, format: 'json' })).blocks.map((b: any) => b.text).sort()
  assert.deepEqual(await texts(), ['four', 'three'])

  const r = await call(HUMAN, 'restore_version', { board, version: cp.id })
  assert.equal(r.changeSet, null, 'people restore directly')
  assert.deepEqual(r.summary, { added: 2, removed: 1, changed: 0 })
  assert.deepEqual(await texts(), ['one', 'three', 'two'])

  const listed = (await call(HUMAN, 'list_versions', { board })).versions
  const before = listed.find((v: any) => v.id === r.checkpoint)
  assert.equal(before.kind, 'before-restore')
  assert.match(before.name, /Before restoring “Three ideas”/)

  await call(HUMAN, 'restore_version', { board, version: r.checkpoint })
  assert.deepEqual(await texts(), ['four', 'three'], 'restoring the pre-restore checkpoint undoes the restore')
})

test('an agent restore is a reviewable change set; rejecting it puts everything back', async () => {
  const { call, board } = await setup()
  await call(HUMAN, 'create_blocks', { board, blocks: [{ text: 'keep' }] })
  const v = (await call(AGENT, 'create_version', { board, name: 'Just keep' })).version
  await call(HUMAN, 'create_blocks', { board, blocks: [{ text: 'newer' }] })
  const r = await call(AGENT, 'restore_version', { board, version: v.id })
  assert.ok(r.changeSet, 'agents go through review')
  const sets = (await call(HUMAN, 'list_change_sets', { board })).changeSets
  assert.equal(sets.find((c: any) => c.id === r.changeSet).status, 'pending')
  await call(HUMAN, 'review_change_set', { board, id: r.changeSet, action: 'reject' })
  const texts = (await call(HUMAN, 'get_board', { board, format: 'json' })).blocks.map((b: any) => b.text).sort()
  assert.deepEqual(texts, ['keep', 'newer'])
})

test('prepare_restore (canvas) checkpoints and returns the plan without applying it', async () => {
  const { call, board } = await setup()
  await call(HUMAN, 'create_blocks', { board, blocks: [{ text: 'a' }] })
  const v = (await call(HUMAN, 'create_version', { board, name: 'A' })).version
  await call(HUMAN, 'create_blocks', { board, blocks: [{ text: 'b' }] })
  const p = await call(HUMAN, 'prepare_restore', { board, version: v.id })
  assert.equal(p.plan.deleteBlocks.length, 1)
  assert.equal((await call(HUMAN, 'get_board', { board, format: 'json' })).blocks.length, 2, 'nothing applied yet')
  assert.ok(p.checkpoint)
  await assert.rejects(call(AGENT, 'prepare_restore', { board, version: v.id }), /can only be used by a human/)
})

test('get_version returns the content and what restoring would change; bad ids are clear errors', async () => {
  const { call, board } = await setup()
  await call(HUMAN, 'create_blocks', { board, blocks: [{ text: 'x' }, { text: 'y' }] })
  const v = (await call(HUMAN, 'create_version', { board, name: 'XY' })).version
  await call(HUMAN, 'create_blocks', { board, blocks: [{ text: 'z' }] })
  const g = await call(HUMAN, 'get_version', { board, version: v.id })
  assert.equal(g.blocks.length, 2)
  assert.deepEqual(g.diff, { added: 0, removed: 1, changed: 0 })
  await assert.rejects(call(HUMAN, 'restore_version', { board, version: 'vnope' }), /No version "vnope"/)
  await assert.rejects(call(HUMAN, 'restore_version', { board, version: '../../etc/passwd' }), /No version/)
})

test('undoing an agent keeps the state before the undo as a version', async () => {
  const { call, board } = await setup()
  const r = await call(AGENT, 'create_blocks', { board, blocks: [{ text: 'agent idea' }] })
  await call(HUMAN, 'undo_changes', { board, change_set: r.changeSet })
  const v = (await call(HUMAN, 'list_versions', { board })).versions[0]
  assert.match(v.name, /Before undoing/)
})
