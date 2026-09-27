import { createHash, createHmac, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import type http from 'node:http'
import path from 'node:path'
import { ASSET_LIMITS, assetFileName, extForMime, IMAGE_MIMES, imageInfo, videoInfo, type Asset, type AssetRole } from '@aifig/shared'
import type { Board } from './board'

/**
 * Asset files over HTTP. Media elements (`<img>`, `<video>`) can't send the access token as a header, so
 * GETs also accept `?k=<asset key>`: an HMAC of the token (it rotates with it) that only reads asset files.
 * Files are served as opaque downloads — never as HTML on the app's origin — with Range support for video.
 */

export const assetKeyFor = (token: string) => createHmac('sha256', token).update('aifig-assets-v1').digest('base64url').slice(0, 32)

export const ASSET_PATH_RE = /^\/api\/assets\/([\w-]+)\/([\w-]+)(?:\/[^/]*)?$/

export function serveAsset(req: http.IncomingMessage, res: http.ServerResponse, board: Board, asset: Asset) {
  const file = board.assetPath(asset)
  if (!file) {
    res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    return res.end(JSON.stringify({ ok: false, error: `${asset.name ?? assetFileName(asset)} is missing from the assets folder` }))
  }
  const size = fs.statSync(file).size
  const etag = `"${asset.hash}"`
  const headers: Record<string, string | number> = {
    'content-type': asset.role.startsWith('snippet-') ? 'text/plain; charset=utf-8' : asset.mime,
    'accept-ranges': 'bytes',
    etag,
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'cross-origin-resource-policy': 'same-origin',
    'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(asset.name ?? assetFileName(asset))}`,
  }
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers)
    return res.end()
  }
  const range = typeof req.headers.range === 'string' ? req.headers.range.match(/^bytes=(\d*)-(\d*)$/) : null
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2])
    let end = range[1] && range[2] ? Number(range[2]) : size - 1
    start = Math.max(0, start)
    end = Math.min(size - 1, end)
    if (start > end || start >= size) {
      res.writeHead(416, { 'content-range': `bytes */${size}` })
      return res.end()
    }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 })
    if (req.method === 'HEAD') return res.end()
    return fs.createReadStream(file, { start, end }).pipe(res)
  }
  res.writeHead(200, { ...headers, 'content-length': size })
  if (req.method === 'HEAD') return res.end()
  fs.createReadStream(file).pipe(res)
}

const ROLES: AssetRole[] = ['image', 'video', 'poster']

/**
 * Upload a file into a board's assets folder: streamed to a temp file while hashed, checked by its bytes
 * (image or video, within the size limits), then moved into place and recorded in the `assets` map.
 */
export async function receiveUpload(req: http.IncomingMessage, board: Board, url: URL): Promise<{ status: number; body: unknown }> {
  const role = (url.searchParams.get('role') ?? 'image') as AssetRole
  if (!ROLES.includes(role)) return { status: 400, body: { ok: false, error: `role must be one of ${ROLES.join(', ')}` } }
  const name = (url.searchParams.get('name') ?? '').replace(/[\\/\0]/g, '').slice(0, 120) || undefined
  const max = role === 'video' ? ASSET_LIMITS.videoBytes : role === 'poster' ? ASSET_LIMITS.posterBytes : ASSET_LIMITS.imageBytes
  const declared = Number(req.headers['content-length'] ?? 0)
  if (declared > max) return { status: 413, body: { ok: false, error: `The file is larger than ${Math.round(max / 1024 / 1024)} MB` } }
  fs.mkdirSync(board.assetsDir, { recursive: true })
  const tmp = path.join(board.assetsDir, `.upload-${process.pid}-${randomBytes(6).toString('hex')}.tmp`)
  const hash = createHash('sha256')
  let size = 0
  try {
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(tmp, { mode: 0o644 })
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > max) {
          req.destroy()
          out.destroy()
          reject(Object.assign(new Error(`The file is larger than ${Math.round(max / 1024 / 1024)} MB`), { status: 413 }))
          return
        }
        hash.update(chunk)
        if (!out.write(chunk)) {
          req.pause()
          out.once('drain', () => req.resume())
        }
      })
      req.on('end', () => out.end())
      req.on('error', reject)
      out.on('finish', resolve)
      out.on('error', reject)
    })
    const fd = fs.openSync(tmp, 'r')
    let info: { mime: string; w: number; h: number; duration?: number } | null
    try {
      const reader = (pos: number, len: number) => {
        const buf = Buffer.alloc(Math.max(0, Math.min(len, size - pos)))
        if (buf.length) fs.readSync(fd, buf, 0, buf.length, pos)
        return buf
      }
      info = role === 'video' ? videoInfo(reader, size) : imageInfo(reader(0, Math.min(size, 1 << 20)))
    } finally {
      fs.closeSync(fd)
    }
    if (!info || (role !== 'video' && !IMAGE_MIMES.includes(info.mime))) {
      fs.rmSync(tmp, { force: true })
      return { status: 415, body: { ok: false, error: role === 'video' ? 'Unsupported video — use an MP4 (H.264) or WebM file' : 'Unsupported image — use PNG, JPEG, GIF or WebP' } }
    }
    const meta = { mime: info.mime, ext: extForMime(info.mime), role, name, w: info.w, h: info.h, duration: info.duration }
    let asset!: Asset
    const digest = hash.digest('hex')
    board.doc.transact(() => (asset = board.adoptAssetFile(tmp, digest, size, meta)), 'api')
    return { status: 200, body: { ok: true, asset } }
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    return { status: (e as { status?: number }).status ?? 500, body: { ok: false, error: (e as Error).message } }
  }
}

/** Stream a request body to `file` (at most `max` bytes). */
export function saveBody(req: http.IncomingMessage, file: string, max: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let size = 0
    const out = fs.createWriteStream(file, { mode: 0o600 })
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > max) {
        req.destroy()
        out.destroy()
        fs.rmSync(file, { force: true })
        reject(Object.assign(new Error(`The file is larger than ${Math.round(max / 1024 / 1024)} MB`), { status: 413 }))
        return
      }
      if (!out.write(chunk)) {
        req.pause()
        out.once('drain', () => req.resume())
      }
    })
    req.on('end', () => out.end())
    req.on('error', reject)
    out.on('finish', () => resolve(size))
    out.on('error', reject)
  })
}

/** Uploaded packs wait here (private to the core) until they're imported; stale ones are removed. */
export function incomingDir(home: string) {
  const dir = path.join(home, 'incoming')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    try {
      if (Date.now() - fs.statSync(p).mtimeMs > 24 * 3_600_000) fs.rmSync(p, { recursive: true, force: true })
    } catch {
      // gone
    }
  }
  return dir
}

export const tempName = (ext: string) => `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}${ext}`
