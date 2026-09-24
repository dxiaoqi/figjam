import { toast } from 'sonner'

export type ExportFormat = 'png' | 'svg'

/** Rendered by the core with the same tokens and routing as the canvas. */
async function fetchSnapshot(boardId: string, format: ExportFormat, opts: { ids?: string[]; theme: 'light' | 'dark' }) {
  const q = new URLSearchParams({ theme: opts.theme })
  if (opts.ids?.length) q.set('ids', opts.ids.join(','))
  const r = await fetch(`/api/boards/${encodeURIComponent(boardId)}/snapshot.${format}?${q}`)
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `Export failed (${r.status})`)
  return r.blob()
}

export async function downloadSnapshot(boardId: string, title: string, format: ExportFormat, opts: { ids?: string[]; theme: 'light' | 'dark' }) {
  try {
    const blob = await fetchSnapshot(boardId, format, opts)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(title || 'board').replace(/[^\w\u4e00-\u9fff-]+/g, '-').replace(/^-|-$/g, '') || 'board'}${opts.ids?.length ? '-selection' : ''}.${format}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    toast.success(`Exported ${format.toUpperCase()}`)
  } catch (e) {
    toast.error((e as Error).message)
  }
}

export async function copySnapshot(boardId: string, opts: { ids?: string[]; theme: 'light' | 'dark' }) {
  try {
    const blob = fetchSnapshot(boardId, 'png', opts)
    // pass the promise so Safari keeps the user gesture
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    toast.success('Copied as PNG')
  } catch (e) {
    toast.error(`Couldn’t copy the image — ${(e as Error).message}`)
  }
}
