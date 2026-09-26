import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Board, boardsDir } from '../../packages/core/src/board'
import { tempHome } from './helpers'

const writer = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'writer.ts')

function run(mode: string, home: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', writer, mode], { env: { ...process.env, AIFIG_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout!.on('data', (d) => (out += d))
  const waitFor = (re: RegExp, ms = 20_000) =>
    new Promise<RegExpMatchArray>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timed out waiting for ${re} (got: ${out.slice(-200)})`)), ms)
      const check = () => {
        const m = out.match(re)
        if (m) {
          clearTimeout(t)
          child.stdout!.off('data', check)
          resolve(m)
        }
      }
      child.stdout!.on('data', check)
      check()
    })
  return { child, waitFor, output: () => out }
}

const exited = (c: ChildProcess) => new Promise((r) => (c.exitCode !== null || c.signalCode !== null ? r(null) : c.once('exit', r)))

function loadOnly(file: string) {
  return Board.fromBytes('check', fs.readFileSync(file), file, { persist: false }).board
}

test('kill -9 in the middle of writes never leaves a damaged or older-than-acknowledged board', async () => {
  const home = tempHome('crash')
  let lastAcked = 0
  for (let round = 0; round < 6; round++) {
    const w = run('loop', home)
    await w.waitFor(new RegExp(`saved ${lastAcked + 3}\\b`))
    // land the kill at a random point inside the write loop
    await new Promise((r) => setTimeout(r, Math.random() * 120))
    w.child.kill('SIGKILL')
    await exited(w.child)
    const acked = Math.max(...[...w.output().matchAll(/saved (\d+)/g)].map((m) => Number(m[1])))
    const file = path.join(boardsDir(), fs.readdirSync(boardsDir()).find((f) => f.endsWith('.aifig'))!)
    const b = loadOnly(file)
    const count = [...b.blocks.keys()].filter((k) => k.startsWith('c')).length
    assert.ok(count >= acked, `round ${round}: file has ${count} blocks, ${acked} were acknowledged`)
    assert.ok(count <= acked + 1, `round ${round}: at most the in-flight write is extra`)
    lastAcked = count
  }
  const temps = fs.readdirSync(boardsDir()).filter((f) => f.endsWith('.tmp'))
  // leftovers from the kills are cleaned on the next start (after they're 10s old); none may shadow the board
  assert.ok(temps.every((t) => t.startsWith('.')), `temp files are hidden dot-files: ${temps}`)
})

test('SIGTERM flushes edits that were still waiting for the debounce', async () => {
  const home = tempHome('term')
  const seed = run('loop', home)
  await seed.waitFor(/saved 1\b/)
  seed.child.kill('SIGKILL')
  await exited(seed.child)

  const w = run('edit', home)
  await w.waitFor(/edited/)
  w.child.kill('SIGTERM')
  await exited(w.child)
  const file = path.join(boardsDir(), fs.readdirSync(boardsDir()).find((f) => f.endsWith('.aifig'))!)
  assert.equal(loadOnly(file).blocks.get('unsaved')?.text, 'written on the way out')
})
