import type { Asset, AssetRole, WebSnippet } from '@aifig/shared'
import { apiFetch } from './auth'

/**
 * Asset files are served by the core (`/api/assets/<board>/<asset>`). `<img>` and `<video>` can't send the
 * access token, so their URLs carry the asset key from /api/health: it only reads asset files.
 */
let assetKey = ''

export function setAssetKey(key: string | undefined) {
  assetKey = key ?? ''
}

export function assetUrl(boardId: string, asset: Pick<Asset, 'id' | 'name' | 'ext'>) {
  const name = encodeURIComponent(asset.name ?? `file.${asset.ext}`)
  return `/api/assets/${encodeURIComponent(boardId)}/${encodeURIComponent(asset.id)}/${name}?k=${encodeURIComponent(assetKey)}`
}

export async function fetchAssetText(boardId: string, asset: Pick<Asset, 'id' | 'name' | 'ext'>) {
  const r = await apiFetch(assetUrl(boardId, asset))
  if (!r.ok) throw new Error(`Couldn’t read ${asset.name ?? 'the file'} (${r.status})`)
  return r.text()
}

/** Upload a file into the board's assets folder (the core checks what it is). Progress 0–1 for large files. */
export function uploadAsset(boardId: string, file: Blob, role: AssetRole, name?: string, onProgress?: (p: number) => void): Promise<Asset> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const q = new URLSearchParams({ role, ...(name ? { name } : {}) })
    xhr.open('POST', `/api/boards/${encodeURIComponent(boardId)}/assets?${q}`)
    const token = (globalThis as { aifigDesktop?: { token?: string } }).aifigDesktop?.token ?? localStorage.getItem('aifig:token')
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`)
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total)
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText)
        if (xhr.status === 200 && body.ok) resolve(body.asset as Asset)
        else reject(new Error(body.error ?? `Upload failed (${xhr.status})`))
      } catch {
        reject(new Error(`Upload failed (${xhr.status})`))
      }
    }
    xhr.onerror = () => reject(new Error('Upload failed: the core is not reachable'))
    xhr.send(file)
  })
}

/** A frame from a video (about a tenth in, at most 1 s) as a WebP poster, plus its natural size and duration. */
export async function capturePoster(src: string): Promise<{ blob: Blob; w: number; h: number; duration: number }> {
  const v = document.createElement('video')
  v.muted = true
  v.playsInline = true
  v.preload = 'auto'
  v.crossOrigin = 'anonymous'
  v.src = src
  await new Promise<void>((resolve, reject) => {
    v.onloadedmetadata = () => resolve()
    v.onerror = () => reject(new Error('This video can’t be decoded here'))
  })
  const t = Math.min(1, (v.duration || 0) / 10)
  await new Promise<void>((resolve) => {
    v.onseeked = () => resolve()
    v.currentTime = t
    setTimeout(resolve, 3000)
  })
  const w = v.videoWidth || 640
  const h = v.videoHeight || 360
  const k = Math.min(1, 1280 / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * k)
  canvas.height = Math.round(h * k)
  canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No poster'))), 'image/webp', 0.84))
  const duration = Number.isFinite(v.duration) ? v.duration : 0
  v.removeAttribute('src')
  v.load()
  return { blob, w, h, duration }
}

export const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(b)
  })

/** A file's text never changes for a given asset id, so it's fetched once. */
const textCache = new Map<string, Promise<string>>()

function assetText(boardId: string, asset: Pick<Asset, 'id' | 'name' | 'ext'>) {
  const key = `${boardId}/${asset.id}`
  let p = textCache.get(key)
  if (!p) {
    p = fetchAssetText(boardId, asset)
    p.catch(() => textCache.delete(key))
    textCache.set(key, p)
  }
  return p
}

/** Inline snippet source as text: from its files (web.src), or inline (older documents). */
export async function snippetText(boardId: string, assets: Map<string, Asset> | { get(id: string): Asset | undefined }, web: WebSnippet | undefined): Promise<Pick<WebSnippet, 'html' | 'css' | 'js'>> {
  if (!web || web.mode !== 'inline') return {}
  if (!web.src) return { html: web.html, css: web.css, js: web.js }
  const read = (id?: string) => {
    const a = id ? assets.get(id) : undefined
    return a ? assetText(boardId, a) : Promise.resolve('')
  }
  const [html, css, js] = await Promise.all([read(web.src.html), read(web.src.css), read(web.src.js)])
  return { html, css, js }
}
