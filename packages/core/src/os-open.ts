import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export type OpenMode = 'reveal' | 'open' | 'edit'

function onPath(name: string) {
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', ''] : ['']
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const e of exts) {
      const f = path.join(dir, name + e)
      try {
        if (fs.statSync(f).isFile()) return f
      } catch {
        // keep looking
      }
    }
  }
  return null
}

/**
 * How to show a file: `reveal` selects it in Finder / Explorer (Linux: opens its folder), `open` uses the
 * default app, `edit` opens source in a code editor — never the default app, which for .html would be a
 * browser running the snippet unsandboxed. NODBOARD_EDITOR (e.g. "code -n") picks the editor.
 */
export function osCommand(target: string, mode: OpenMode): { cmd: string; args: string[] } {
  const plat = process.platform
  if (mode === 'edit') {
    const custom = process.env.NODBOARD_EDITOR?.trim()
    if (custom) {
      const [cmd, ...args] = custom.split(/\s+/)
      return { cmd, args: [...args, target] }
    }
    for (const ed of ['cursor', 'code']) {
      const found = onPath(ed)
      if (found) return { cmd: found, args: [target] }
    }
    const dir = fs.existsSync(target) && fs.statSync(target).isDirectory()
    if (plat === 'darwin') return dir ? { cmd: 'open', args: [target] } : { cmd: 'open', args: ['-t', target] }
    if (plat === 'win32') return dir ? { cmd: 'explorer', args: [target] } : { cmd: 'notepad', args: [target] }
    return { cmd: 'xdg-open', args: [dir ? target : path.dirname(target)] }
  }
  if (mode === 'reveal') {
    if (plat === 'darwin') return { cmd: 'open', args: ['-R', target] }
    if (plat === 'win32') return { cmd: 'explorer', args: [`/select,${target}`] }
    const dir = fs.existsSync(target) && fs.statSync(target).isDirectory() ? target : path.dirname(target)
    return { cmd: 'xdg-open', args: [dir] }
  }
  if (plat === 'darwin') return { cmd: 'open', args: [target] }
  if (plat === 'win32') return { cmd: 'explorer', args: [target] }
  return { cmd: 'xdg-open', args: [target] }
}

/** Run it detached. With NODBOARD_REVEAL=off (tests, headless machines) nothing is launched. */
export async function openInOs(target: string, mode: OpenMode): Promise<{ path: string; opened: boolean; command: string }> {
  const { cmd, args } = osCommand(target, mode)
  const command = [cmd, ...args].join(' ')
  if (process.env.NODBOARD_REVEAL === 'off') return { path: target, opened: false, command }
  const opened = await new Promise<boolean>((resolve) => {
    try {
      const p = spawn(cmd, args, { detached: true, stdio: 'ignore' })
      p.once('error', () => resolve(false))
      p.once('spawn', () => {
        p.unref()
        resolve(true)
      })
    } catch {
      resolve(false)
    }
  })
  return { path: target, opened, command }
}
