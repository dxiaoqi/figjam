// Reports CI steps to Origin as check runs on the commit being tested (one suite "ai-figma CI", one run per step),
// so they show up in the pull request's Checks tab and can be required before merging.
//
// Environment:
//   ORIGIN_CHECKS_TOKEN  installation token of an Origin App installed on the repo, with repository:checks:write
//   ORIGIN_REPO          owner/repo (default: parsed from the `origin` git remote)
//   ORIGIN_SHA           commit to report on (default: HEAD)
//   ORIGIN_API_URL       default https://api.cursor.com
//   CI_RUN_ID            identifies this attempt (default: time-based); re-running with a new id starts a new attempt
//   CI_DETAILS_URL       optional link shown on each check (e.g. the agent run that executed CI)
import { spawnSync } from 'node:child_process'

const git = (root, ...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' }).stdout.trim()

function repoFromRemote(root) {
  const url = git(root, 'remote', 'get-url', 'origin')
  const m = url.match(/origin\.cursor\.com\/git\/([^/]+)\/([^/.]+)(?:\.git)?$/) ?? url.match(/codebase\/([^/]+)\/([^/.]+)/)
  return m ? `${m[1]}/${m[2]}` : null
}

const MAX_TEXT = 60_000

export function originReporter({ enabled, root, steps }) {
  const noop = { queued: async () => {}, started: async () => {}, done: async () => {} }
  if (!enabled) return noop
  const token = process.env.ORIGIN_CHECKS_TOKEN
  const repo = process.env.ORIGIN_REPO ?? repoFromRemote(root)
  const sha = process.env.ORIGIN_SHA ?? git(root, 'rev-parse', 'HEAD')
  if (!token || !repo || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) {
    console.warn(`[ci] Origin reporting is off: ${!token ? 'ORIGIN_CHECKS_TOKEN is not set' : !repo ? 'set ORIGIN_REPO=owner/repo' : `no commit SHA (${sha || 'empty'})`}`)
    return noop
  }
  const [owner, name] = repo.split('/')
  const api = (process.env.ORIGIN_API_URL ?? 'https://api.cursor.com').replace(/\/$/, '')
  const runId = process.env.CI_RUN_ID ?? `ci-${Date.now().toString(36)}`
  const detailsUrl = process.env.CI_DETAILS_URL || undefined
  const startedAt = new Map()
  // externalUpdatedAt orders writes to a run; keep it strictly increasing even within one millisecond
  let last = 0
  const stamp = () => new Date((last = Math.max(Date.now(), last + 1))).toISOString()

  async function post(step, run) {
    const body = {
      headSha: sha,
      checkSuite: { key: 'aifig-ci', name: 'ai-figma CI', externalId: runId, ...(detailsUrl ? { detailsUrl } : {}) },
      checkRun: { key: step.id, name: step.name, externalId: `${runId}:${step.id}`, externalUpdatedAt: stamp(), ...(detailsUrl ? { detailsUrl } : {}), ...run },
    }
    try {
      const r = await fetch(`${api}/v1/origin/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/check-runs`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      })
      if (!r.ok) console.warn(`[ci] Origin check run ${step.id}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`)
    } catch (e) {
      console.warn(`[ci] Origin check run ${step.id}: ${e.message}`)
    }
  }

  console.log(`[ci] reporting check runs to ${repo} @ ${sha.slice(0, 10)} (attempt ${runId})`)
  return {
    queued: () => Promise.all(steps.map((s) => post(s, { status: 'queued' }))),
    started: (step) => {
      startedAt.set(step.id, new Date().toISOString())
      return post(step, { status: 'in_progress', startedAt: startedAt.get(step.id) })
    },
    done: (step, conclusion, detail = '', ms = 0) => {
      const title = conclusion === 'success' ? `Passed in ${(ms / 1000).toFixed(1)} s` : conclusion === 'skipped' ? 'Skipped' : 'Failed'
      return post(step, {
        status: 'completed',
        conclusion,
        ...(startedAt.has(step.id) ? { startedAt: startedAt.get(step.id) } : {}),
        completedAt: new Date().toISOString(),
        output: { title, summary: conclusion === 'failure' ? `\`${step.cmd.join(' ')}\` failed.` : title, ...(detail ? { text: `\`\`\`\n${detail.slice(-MAX_TEXT)}\n\`\`\`` } : {}) },
      })
    },
  }
}
