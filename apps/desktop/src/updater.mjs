// Auto-update through electron-updater's generic provider. Off unless a feed URL is configured (distribution.json,
// AIFIG_UPDATE_URL or `updates.feedUrl` in ~/.aifig/config.json), and in unpacked/dev runs. AIFIG_UPDATES=off
// disables it on one machine. macOS installs updates only for Developer ID–signed builds (Squirrel.Mac checks).
import updater from 'electron-updater'

const SIX_HOURS = 6 * 60 * 60 * 1000

export function startUpdater({ feedUrl, packaged, env = process.env, log = () => {} }) {
  if (!feedUrl) return { enabled: false, reason: 'no feed URL configured' }
  if (!packaged) return { enabled: false, reason: 'not a packaged build' }
  if (/^(0|off|false|no)$/i.test(env.AIFIG_UPDATES ?? '')) return { enabled: false, reason: 'AIFIG_UPDATES=off' }
  const { autoUpdater } = updater
  autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl })
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} }
  autoUpdater.on('error', (e) => log(`update check failed: ${e?.message ?? e}`))
  const check = () => autoUpdater.checkForUpdatesAndNotify().catch((e) => log(`update check failed: ${e?.message ?? e}`))
  setTimeout(check, 10_000).unref?.()
  setInterval(check, SIX_HOURS).unref?.()
  return { enabled: true, feedUrl }
}
