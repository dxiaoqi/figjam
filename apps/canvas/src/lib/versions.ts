import { toast } from 'sonner'
import type { Editor } from '@aifig/canvas-engine'
import type { Block, Connector, DiffSummary, RestorePlan, VersionInfo } from '@aifig/shared'
import { callCore } from './core'

export const openVersionHistory = (opts: { checkpoint?: boolean } = {}) => window.dispatchEvent(new CustomEvent('aifig:versions', { detail: opts }))

export const versionPreviewUrl = (boardId: string, id: string, theme: 'light' | 'dark') =>
  `/api/boards/${encodeURIComponent(boardId)}/versions/${encodeURIComponent(id)}/preview.svg?theme=${theme}`

export function versionLabel(v: Pick<VersionInfo, 'kind' | 'name'>) {
  if (v.kind === 'checkpoint') return v.name
  if (v.kind === 'auto' && v.name === 'Autosave') return 'Autosave'
  return v.name || 'Autosave'
}

export const KIND_BADGE: Record<VersionInfo['kind'], string | null> = {
  checkpoint: 'Checkpoint',
  'before-restore': 'Before restore',
  recovered: 'Recovered',
  opened: 'Opened',
  auto: null,
}

export function summarize(d: DiffSummary) {
  const parts = [d.added && `brings back ${d.added} block${d.added === 1 ? '' : 's'}`, d.removed && `removes ${d.removed}`, d.changed && `changes ${d.changed}`].filter(Boolean)
  return parts.length ? `Restoring ${parts.join(', ')}.` : 'Same blocks as now.'
}

/**
 * Restore in the canvas: the core checkpoints the current state and returns the edits, and the editor
 * applies them as one local transaction — so ⌘Z undoes the restore like any other edit.
 */
export async function restoreVersion(editor: Editor, boardId: string, v: VersionInfo) {
  const r = await callCore<{ unchanged?: boolean; summary: DiffSummary; checkpoint: string | null; plan?: RestorePlan }>('prepare_restore', { board: boardId, version: v.id })
  if (r.unchanged || !r.plan) {
    toast('The board already matches this version.')
    return
  }
  const plan = r.plan
  const blocks = editor.doc.getMap<Block>('blocks')
  const connectors = editor.doc.getMap<Connector>('connectors')
  editor.undoManager.stopCapturing()
  editor.transact(() => {
    for (const b of plan.upsertBlocks) blocks.set(b.id, { ...b, editedBy: { kind: 'human', id: 'human:ui', name: 'You' }, updatedAt: Date.now() })
    for (const c of plan.upsertConnectors) connectors.set(c.id, { ...c, updatedAt: Date.now() })
    for (const id of plan.deleteConnectors) connectors.delete(id)
    for (const id of plan.deleteBlocks) blocks.delete(id)
  })
  editor.undoManager.stopCapturing()
  editor.select([])
  toast.success(`Restored “${versionLabel(v)}”`, {
    description: 'The previous state was saved as a version.',
    action: { label: 'Undo', onClick: () => editor.undo() },
  })
}

export async function openBackupFolder(boardId?: string) {
  try {
    const r = await callCore<{ path: string; opened: boolean }>('open_backup_folder', { board: boardId })
    if (r.opened) toast('Opened the backup folder', { description: r.path })
    else
      toast('Backups are kept here', {
        description: r.path,
        action: { label: 'Copy path', onClick: () => navigator.clipboard?.writeText(r.path) },
      })
  } catch (e) {
    toast.error((e as Error).message)
  }
}
