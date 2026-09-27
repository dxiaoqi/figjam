// Serves the static export in ./out, for checking the build as a static host would: compressed text
// (brotli or gzip) and long-lived caching for hashed assets and media, short caching for HTML.
// Text is compressed once per file and sent whole with a Content-Length, like the precompressed files a static host
// or CDN serves. Streaming it through a brotli compressor instead made headless Chrome hold the first frame ~1.2 s
// on the home page, which cost ~1.4 s of Speed Index in Lighthouse and wasn't what visitors get.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../out/', import.meta.url))
const port = Number(process.env.PORT || 47901)
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
}

const compressible = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.xml'])
const packed = new Map()

function compressed(file, br) {
  const { mtimeMs } = statSync(file)
  const key = `${br ? 'br' : 'gz'}:${file}`
  const hit = packed.get(key)
  if (hit?.mtimeMs === mtimeMs) return hit.body
  const raw = readFileSync(file)
  const body = br ? brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }) : gzipSync(raw, { level: 9 })
  packed.set(key, { mtimeMs, body })
  return body
}

function cacheControl(path) {
  if (path.startsWith('/_next/static/')) return 'public, max-age=31536000, immutable'
  if (/^\/(media|og)\//.test(path) || path === '/favicon.svg') return 'public, max-age=604800'
  return 'public, max-age=0, must-revalidate'
}

if (!existsSync(root)) {
  console.error('No ./out folder. Run `npm run build` first.')
  process.exit(1)
}

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
  let file = join(root, path)
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  if (!existsSync(file)) {
    res.writeHead(404, { 'content-type': types['.html'] })
    return createReadStream(join(root, '404.html')).on('error', () => res.end('Not found')).pipe(res)
  }
  const { size } = statSync(file)
  const type = types[extname(file)] ?? 'application/octet-stream'
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/)
  if (range) {
    const start = range[1] ? Number(range[1]) : 0
    const end = range[2] ? Number(range[2]) : size - 1
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 })
    return createReadStream(file, { start, end }).pipe(res)
  }
  const headers = { 'content-type': type, 'cache-control': cacheControl(path), vary: 'accept-encoding' }
  const accept = String(req.headers['accept-encoding'] ?? '')
  if (compressible.has(extname(file)) && /\b(br|gzip)\b/.test(accept)) {
    const br = /\bbr\b/.test(accept)
    const body = compressed(file, br)
    res.writeHead(200, { ...headers, 'content-encoding': br ? 'br' : 'gzip', 'content-length': body.length })
    return res.end(body)
  }
  res.writeHead(200, { ...headers, 'content-length': size, 'accept-ranges': 'bytes' })
  createReadStream(file).pipe(res)
}).listen(port, '127.0.0.1', () => console.log(`Static export on http://127.0.0.1:${port}`))
