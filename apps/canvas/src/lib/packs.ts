import { apiFetch, authHeaders } from './auth'

export interface PackManifest {
  format: string
  version: number
  createdAt: string
  app: string
  board: { title: string; schema: string; blocks: number }
  includes: { history: boolean; comments: boolean; skills: string[] }
  files: { path: string; size: number; sha256: string }[]
  missing?: string[]
}

export interface PackPreview {
  path: string
  size: number
  manifest: PackManifest
  defaultDest: string
}

/** Browser export: the core builds the pack and the browser downloads it. */
export async function downloadPack(boardId: string, opts: { history: boolean; comments: boolean }) {
  const q = new URLSearchParams({ history: opts.history ? '1' : '0', comments: opts.comments ? '1' : '0' })
  const r = await apiFetch(`/api/boards/${encodeURIComponent(boardId)}/pack.nodboardpack?${q}`)
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Export failed (${r.status})`)
  const name = decodeURIComponent(r.headers.get('content-disposition')?.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? 'board.nodboardpack')
  const url = URL.createObjectURL(await r.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return name
}

/** Upload a pack for import; the core checks it and returns what's inside. */
export function uploadPack(file: File, onProgress?: (p: number) => void): Promise<PackPreview> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/packs')
    for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v)
    xhr.setRequestHeader('content-type', 'application/zip')
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total)
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText)
        if (body.ok) resolve(body as PackPreview)
        else reject(new Error(body.error ?? `Upload failed (${xhr.status})`))
      } catch {
        reject(new Error(`Upload failed (${xhr.status})`))
      }
    }
    xhr.onerror = () => reject(new Error('Upload failed: the core is not reachable'))
    xhr.send(file)
  })
}

export const openExportPack = () => window.dispatchEvent(new Event('nodboard:export-pack'))
/** Open the import dialog, with a pack already on disk (desktop file association) or a file picker. */
export const openImportPack = (path?: string) => window.dispatchEvent(new CustomEvent('nodboard:import-pack', { detail: { path } }))
