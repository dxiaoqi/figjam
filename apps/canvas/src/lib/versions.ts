import { toast } from 'sonner'
import type { Editor } from '@nodboard/canvas-engine'
import type { Block, Connector, DiffSummary, RestorePlan, VersionInfo } from '@nodboard/shared'
import { callCore } from './core'
import { t, type MessageKey } from '../i18n'

export const openVersionHistory = (opts: { checkpoint?: boolean } = {}) => window.dispatchEvent(new CustomEvent('nodboard:versions', { detail: opts }))

export const versionPreviewUrl = (boardId: string, id: string, theme: 'light' | 'dark') =>
  `/api/boards/${encodeURIComponent(boardId)}/versions/${encodeURIComponent(id)}/preview.svg?theme=${theme}`

export function versionLabel(v: Pick<VersionInfo, 'kind' | 'name'>) {
  if (v.kind === 'checkpoint') return v.name
  return !v.name || v.name === 'Autosave' ? t('versions.autosave') : v.name
}

export const kindBadge = (kind: VersionInfo['kind']) => (kind === 'auto' ? null : t(`versions.kind.${kind}` as MessageKey))

export function summarize(d: DiffSummary) {
  const parts = [d.added && t('versions.bringsBack', { count: d.added }), d.removed && t('versions.removes', { count: d.removed }), d.changed && t('versions.changes', { count: d.changed })].filter(Boolean)
  return parts.length ? t('versions.restoring', { parts: parts.join(t('versions.partSep')) }) : t('versions.same')
}

/**
 * Restore in the canvas: the core checkpoints the current state and returns the edits, and the editor
 * applies them as one local transaction — so ⌘Z undoes the restore like any other edit.
 */
export async function restoreVersion(editor: Editor, boardId: string, v: VersionInfo) {
  const r = await callCore<{ unchanged?: boolean; summary: DiffSummary; checkpoint: string | null; plan?: RestorePlan }>('prepare_restore', { board: boardId, version: v.id })
  if (r.unchanged || !r.plan) {
    toast(t('versions.alreadyMatches'))
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
  toast.success(t('versions.restored', { label: versionLabel(v) }), {
    description: t('versions.restoredHint'),
    action: { label: t('versions.undo'), onClick: () => editor.undo() },
  })
}

export async function openBackupFolder(boardId?: string) {
  try {
    const r = await callCore<{ path: string; opened: boolean }>('open_backup_folder', { board: boardId })
    if (r.opened) toast(t('backups.opened'), { description: r.path })
    else
      toast(t('backups.keptHere'), {
        description: r.path,
        action: { label: t('backups.copyPath'), onClick: () => navigator.clipboard?.writeText(r.path) },
      })
  } catch (e) {
    toast.error((e as Error).message)
  }
}
