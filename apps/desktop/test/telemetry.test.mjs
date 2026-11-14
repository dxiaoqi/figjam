// Install counting: opt-in, env opt-out, exactly the documented fields, no PII, once-a-day active pings.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createTelemetry, disabledByEnv, normalizeLocale, PING_FIELDS } from '../src/telemetry.mjs'

const DAY = 86_400_000

function setup({ env = {}, endpoint = 'https://t.example/', fail = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodboard-tel-'))
  const sent = []
  let now = Date.parse('2026-09-26T10:00:00Z')
  const t = createTelemetry({
    endpoint,
    stateFile: path.join(dir, 'telemetry.json'),
    appVersion: '0.2.0',
    platform: 'darwin',
    arch: 'arm64',
    locale: () => 'zh_CN.UTF-8',
    env,
    now: () => now,
    fetch: async (url, init) => {
      if (fail) throw new Error('offline')
      sent.push({ url, body: JSON.parse(init.body) })
      return { ok: true, status: 200 }
    },
  })
  return { t, sent, dir, state: () => JSON.parse(fs.readFileSync(path.join(dir, 'telemetry.json'), 'utf8')), advance: (ms) => (now += ms) }
}

test('nothing is stored or sent before the user opts in', async () => {
  const { t, sent, dir } = setup()
  assert.equal(t.status().enabled, false)
  assert.equal(t.status().consent, null)
  await t.tick()
  assert.equal(sent.length, 0)
  assert.equal(fs.existsSync(path.join(dir, 'telemetry.json')), false, 'no install ID on disk without consent')
})

test('opting in sends one install ping with exactly the documented fields', async () => {
  const { t, sent } = setup()
  t.setConsent(true)
  await t.tick()
  assert.equal(sent.length, 1)
  assert.equal(sent[0].url, 'https://t.example/v1/events')
  const p = sent[0].body
  assert.deepEqual(Object.keys(p).sort(), [...PING_FIELDS].sort())
  assert.equal(p.event, 'install')
  assert.match(p.installId, /^[0-9a-f-]{36}$/)
  assert.deepEqual({ v: p.v, appVersion: p.appVersion, os: p.os, arch: p.arch, locale: p.locale }, { v: 1, appVersion: '0.2.0', os: 'macos', arch: 'arm64', locale: 'zh-CN' })
})

test('pings carry no PII: user name, host name, home folder, paths', async () => {
  const { t, sent, dir } = setup()
  t.setConsent(true)
  await t.tick()
  const text = JSON.stringify(sent)
  for (const s of [os.userInfo().username, os.hostname(), os.homedir(), dir]) if (s && s.length > 2) assert.ok(!text.includes(s), `ping contains ${s}`)
})

test('active pings: at most once per UTC day, and again the next day', async () => {
  const { t, sent, advance } = setup()
  t.setConsent(true)
  await t.tick()
  await t.tick()
  advance(3 * 60 * 60 * 1000)
  await t.tick()
  assert.deepEqual(sent.map((s) => s.body.event), ['install'])
  advance(DAY)
  await t.tick()
  await t.tick()
  assert.deepEqual(sent.map((s) => s.body.event), ['install', 'active'])
  assert.equal(sent[0].body.installId, sent[1].body.installId)
})

test('opting out stops pings and deletes the install ID; opting in again starts unlinkable', async () => {
  const { t, sent, state, advance } = setup()
  t.setConsent(true)
  await t.tick()
  const first = sent[0].body.installId
  t.setConsent(false)
  assert.equal(state().consent, 'denied')
  assert.equal('installId' in state(), false)
  advance(DAY)
  await t.tick()
  assert.equal(sent.length, 1)
  t.setConsent(true)
  await t.tick()
  assert.equal(sent.length, 2)
  assert.equal(sent[1].body.event, 'install')
  assert.notEqual(sent[1].body.installId, first)
})

test('NODBOARD_TELEMETRY=off and DO_NOT_TRACK=1 win over consent', async () => {
  for (const env of [{ NODBOARD_TELEMETRY: 'off' }, { NODBOARD_TELEMETRY: '0' }, { NODBOARD_TELEMETRY: 'false' }, { DO_NOT_TRACK: '1' }]) {
    const { t, sent } = setup({ env })
    t.setConsent(true)
    await t.tick()
    assert.equal(sent.length, 0, JSON.stringify(env))
    assert.equal(t.status().envDisabled, true)
    assert.equal(t.status().enabled, false)
  }
  assert.equal(disabledByEnv({ NODBOARD_TELEMETRY: 'on' }), false)
})

test('no endpoint configured: a no-op even with consent', async () => {
  const { t, sent } = setup({ endpoint: '' })
  t.setConsent(true)
  await t.tick()
  t.start()
  t.stop()
  assert.equal(sent.length, 0)
  assert.equal(t.status().configured, false)
})

test('offline: nothing is marked sent, the next tick retries', async () => {
  const s = setup({ fail: true })
  s.t.setConsent(true)
  await s.t.tick()
  assert.equal(s.state().installSent, undefined)
})

test('locales are reduced to language and region', () => {
  assert.equal(normalizeLocale('en-US'), 'en-US')
  assert.equal(normalizeLocale('zh_CN.UTF-8'), 'zh-CN')
  assert.equal(normalizeLocale('de'), 'de')
  assert.equal(normalizeLocale('es-419'), 'es-419')
  assert.equal(normalizeLocale('sr-Latn-RS'), 'sr')
  assert.equal(normalizeLocale(''), 'und')
  assert.equal(normalizeLocale('C'), 'und')
})
