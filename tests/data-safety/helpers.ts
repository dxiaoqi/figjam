import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Point AIFIG_HOME (boards, history, backups, notices) at a fresh temp folder. */
export function tempHome(label = 'ds') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `aifig-${label}-`))
  process.env.AIFIG_HOME = home
  delete process.env.AIFIG_BACKUP_DIR
  return home
}

export const sticky = (id: string, text = id, extra: Record<string, unknown> = {}) => ({
  id,
  kind: 'sticky' as const,
  x: 0,
  y: 0,
  w: 200,
  h: 200,
  text,
  color: 'yellow' as const,
  size: 'm' as const,
  createdAt: 1,
  updatedAt: 1,
  ...extra,
})
