import { bytesToBase64, estimateLabelSize, placeLabel, rotatedBounds, routeConnector, SpatialGrid, type Block, type Connector, type Rect } from '@aifig/shared'
import { CARD_ACCENT, CARD_BODY_SIZE, CARD_TITLE_SIZE, stickyFontSize, wrapText } from '@aifig/shared'
import { COLORS, FONT_SIZES, LINE_HEIGHT, RADII, SPACING, SURFACES } from '@aifig/shared'
import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import type { Board } from './board'
import { bboxOf, contentHeight } from './layout'
import { BLOCK_TYPES, fieldSummary, typeFields } from '@aifig/shared'

const FONT = `Inter, 'PingFang SC', 'Noto Sans CJK SC', 'Microsoft YaHei', 'DejaVu Sans', sans-serif`

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function textLines(lines: string[], x: number, y: number, fs: number, fill: string, weight = 400, maxLines = 99, ellipsis = true) {
  const lh = fs * LINE_HEIGHT
  const shown = lines.slice(0, maxLines)
  if (ellipsis && lines.length > maxLines && shown.length) shown[shown.length - 1] = `${shown[shown.length - 1].replace(/.{0,2}$/, '')}…`
  return shown
    .map((l, i) => `<text x="${x}" y="${(y + fs + i * lh - (lh - fs) * 0.1).toFixed(1)}" font-size="${fs}" font-weight="${weight}" fill="${fill}">${esc(l)}</text>`)
    .join('')
}

/** Text smaller than this on the PNG is drawn as bars, like the canvas far-zoom view (unreadable anyway, and shaping thousands of runs is slow). */
const MIN_TEXT_PX = 4

/** Replace `<text>` runs that would render below MIN_TEXT_PX with rounded bars of about the same size and color. */
export function greekText(svg: string, zoom: number) {
  if (11 * zoom >= MIN_TEXT_PX) return svg
  return svg.replace(/<text ([^>]*)>([^<]*)<\/text>/g, (whole, attrs: string, body: string) => {
    const num = (name: string) => Number(attrs.match(new RegExp(`(?:^| )${name}="([-\\d.e]+)"`))?.[1] ?? NaN)
    const fs = num('font-size')
    const x = num('x')
    const y = num('y')
    if (!(fs * zoom < MIN_TEXT_PX) || Number.isNaN(x) || Number.isNaN(y)) return whole
    const chars = body.replace(/&[a-z]+;/g, '_')
    let em = 0
    for (const ch of chars) em += ch.codePointAt(0)! >= 0x2e80 ? 1 : 0.55
    const w = em * fs
    const left = /text-anchor="middle"/.test(attrs) ? x - w / 2 : x
    const fill = attrs.match(/fill="([^"]+)"/)?.[1] ?? '#888'
    const opacity = Number(attrs.match(/opacity="([\d.]+)"/)?.[1] ?? 1) * 0.45
    return `<rect x="${left.toFixed(1)}" y="${(y - fs * 0.62).toFixed(1)}" width="${w.toFixed(1)}" height="${(fs * 0.5).toFixed(1)}" rx="${(fs * 0.25).toFixed(1)}" fill="${fill}" opacity="${opacity.toFixed(2)}"/>`
  })
}

const isCollapsed = (b: Block) => (b.kind === 'card' || b.kind === 'sticky') && contentHeight(b) > b.h + 4

/** Same long-content treatment as the canvas: a fade over the last lines and a "Show more" hint. */
function collapsedFade(b: Block, r: Rect, bg: string, ink: string) {
  const id = `fade-${b.id}`
  const h = 56
  return (
    `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg}" stop-opacity="0"/><stop offset="0.6" stop-color="${bg}" stop-opacity="0.94"/><stop offset="1" stop-color="${bg}"/></linearGradient>` +
    `<rect x="${r.x + 1}" y="${r.y + r.h - h}" width="${r.w - 2}" height="${h - 1}" fill="url(#${id})"/>` +
    `<text x="${r.x + SPACING.blockPadding}" y="${r.y + r.h - 12}" font-size="12" font-weight="600" fill="${ink}" opacity="0.7">Show more ⌄</text>`
  )
}

/** Type header ("✦ INSIGHT") at the top of a typed block; returns the svg and the height it takes. */
function typeHeader(b: Block, x: number, y: number, ink: string) {
  if (!b.type) return { svg: '', h: 0 }
  const d = BLOCK_TYPES[b.type]
  const done = b.type === 'todo' && typeFields(b).done
  return { svg: `<text x="${x}" y="${y + 11}" font-size="11" font-weight="650" letter-spacing="0.4" fill="${ink}" opacity="0.72">${done ? '☑' : esc(d.glyph)}  ${esc(d.label.toUpperCase())}</text>`, h: 22 }
}

/** Collapsed field summary at the bottom of a typed block. */
function typeFooter(b: Block, r: Rect, ink: string) {
  const sum = b.type ? fieldSummary(b) : ''
  if (!sum) return ''
  return `<text x="${r.x + SPACING.blockPadding}" y="${r.y + r.h - 14}" font-size="11.5" font-weight="550" fill="${ink}" opacity="0.66">${esc(sum)}</text>`
}

export async function renderSnapshot(
  board: Board,
  opts: { frameId?: string; ids?: string[]; theme: 'light' | 'dark'; format: 'png' | 'svg' },
) {
  const theme = opts.theme
  const surf = SURFACES[theme]
  const all = [...board.blocks.values()]
  let scope = opts.frameId ? all.filter((b) => b.id === opts.frameId || b.parent === opts.frameId) : all
  if (opts.ids?.length) {
    const want = new Set(opts.ids)
    for (const b of all) if (b.parent && want.has(b.parent)) want.add(b.id)
    scope = all.filter((b) => want.has(b.id))
  }
  const rects = new Map<string, Rect>(scope.map((b) => [b.id, board.pageRect(b)]))
  const margin = 48
  const visual = (b: Block) => rotatedBounds(rects.get(b.id)!, b.rotation)
  const bb = scope.length ? bboxOf(scope.map(visual)) : { x: 0, y: 0, w: 480, h: 280 }
  const vx = bb.x - margin
  const vy = bb.y - margin - 24
  const W = Math.ceil(bb.w + margin * 2)
  const H = Math.ceil(bb.h + margin * 2 + 24)

  const parts: string[] = []
  parts.push(`<rect x="${vx}" y="${vy}" width="${W}" height="${H}" fill="${surf.canvas}"/>`)
  if (!scope.length) {
    parts.push(`<text x="${vx + W / 2}" y="${vy + H / 2}" text-anchor="middle" font-size="16" fill="${surf.muted}">This board is empty</text>`)
  }

  const order = (b: Block) => (b.kind === 'frame' ? 0 : 1)
  const sorted = [...scope].sort((p, q) => order(p) - order(q) || (p.index ?? '').localeCompare(q.index ?? ''))
  const pendingOutline = (b: Block | Connector, r: Rect, radius: number) => {
    if (!b.pending) return ''
    const color = b.author?.color ?? '#6E56CF'
    return `<rect x="${r.x - 4}" y="${r.y - 4}" width="${r.w + 8}" height="${r.h + 8}" rx="${radius + 3}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="5 4"/>`
  }

  for (const b of sorted) {
    const r = rects.get(b.id)!
    const c = COLORS[b.color]?.[theme] ?? COLORS.gray[theme]
    const pad = SPACING.blockPadding
    if (b.rotation) parts.push(`<g transform="rotate(${b.rotation} ${r.x + r.w / 2} ${r.y + r.h / 2})">`)
    if (b.kind === 'image') {
      const asset = b.asset ? board.assets.get(b.asset) : undefined
      parts.push(`<clipPath id="clip-${b.id}"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="6"/></clipPath>`)
      if (asset) parts.push(`<image x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip-${b.id})" href="data:${asset.mime};base64,${bytesToBase64(asset.bytes)}"/>`)
      else parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="6" fill="${surf.frame}" stroke="${surf.border}"/>`)
    } else if (b.kind === 'web') {
      const w = b.web
      const asset = w?.thumb ? board.assets.get(w.thumb) : undefined
      parts.push(`<rect x="${r.x}" y="${r.y + 1}" width="${r.w}" height="${r.h}" rx="8" fill="#000" opacity="${theme === 'light' ? 0.05 : 0.3}"/>`)
      parts.push(`<clipPath id="clip-${b.id}"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="8"/></clipPath>`)
      if (asset) {
        parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="8" fill="${surf.surface}"/>`)
        parts.push(`<image x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip-${b.id})" href="data:${asset.mime};base64,${bytesToBase64(asset.bytes)}"/>`)
      } else {
        parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="8" fill="${surf.frame}"/>`)
        parts.push(`<text x="${r.x + r.w / 2}" y="${r.y + r.h / 2 - 4}" text-anchor="middle" font-size="15" font-weight="600" fill="${surf.ink}">${esc(w?.title || (w?.mode === 'url' ? (w?.provider ?? 'Embed') : 'Web snippet'))}</text>`)
        parts.push(`<text x="${r.x + r.w / 2}" y="${r.y + r.h / 2 + 18}" text-anchor="middle" font-size="12" fill="${surf.muted}">${esc(w?.mode === 'url' ? (w.url ?? '') : 'HTML · CSS · JS snippet')}</text>`)
      }
      parts.push(`<rect x="${r.x + 0.5}" y="${r.y + 0.5}" width="${r.w - 1}" height="${r.h - 1}" rx="8" fill="none" stroke="${surf.border}"/>`)
      const badge = w?.mode === 'url' ? `▶ ${w.provider ?? 'Embed'}` : '</> Snippet'
      const bw = badge.length * 6.6 + 16
      parts.push(`<rect x="${r.x + 10}" y="${r.y + 10}" width="${bw}" height="20" rx="10" fill="#000" opacity="0.55"/>`)
      parts.push(`<text x="${r.x + 18}" y="${r.y + 24}" font-size="11" font-weight="600" fill="#fff">${esc(badge)}</text>`)
    } else if (b.kind === 'frame') {
      parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${RADII.frame}" fill="${surf.frame}" stroke="${surf.border}" stroke-width="1"/>`)
      parts.push(`<text x="${r.x + 2}" y="${r.y - 10}" font-size="14" font-weight="600" fill="${surf.muted}">${esc(b.title ?? '')}</text>`)
    } else if (b.kind === 'sticky') {
      const fs = stickyFontSize(b.text, b.w)
      parts.push(`<rect x="${r.x}" y="${r.y + 2}" width="${r.w}" height="${r.h}" rx="${RADII.sticky}" fill="#000" opacity="${theme === 'light' ? 0.06 : 0.25}"/>`)
      parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${RADII.sticky}" fill="${c.bg}"/>`)
      const lines = wrapText(b.text, r.w - pad * 2, fs)
      const collapsed = isCollapsed(b)
      const head = typeHeader(b, r.x + pad, r.y + pad - 2, c.ink)
      parts.push(`<clipPath id="clip-${b.id}"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${RADII.sticky}"/></clipPath>`)
      parts.push(`<g clip-path="url(#clip-${b.id})">`)
      parts.push(head.svg)
      parts.push(textLines(lines, r.x + pad, r.y + pad + head.h, fs, c.ink, 450, Math.max(1, collapsed ? Math.ceil((r.h - pad) / (fs * LINE_HEIGHT)) : Math.floor((r.h - pad * 2) / (fs * LINE_HEIGHT))), !collapsed))
      parts.push('</g>')
      if (collapsed) parts.push(collapsedFade(b, r, c.bg, c.ink))
      else parts.push(typeFooter(b, r, c.ink))
    } else if (b.kind === 'card') {
      parts.push(`<rect x="${r.x}" y="${r.y + 1}" width="${r.w}" height="${r.h}" rx="${RADII.card}" fill="#000" opacity="${theme === 'light' ? 0.05 : 0.3}"/>`)
      parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${RADII.card}" fill="${surf.surface}" stroke="${surf.border}"/>`)
      parts.push(`<clipPath id="clip-${b.id}"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${RADII.card}"/></clipPath>`)
      parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${CARD_ACCENT}" fill="${c.accent}" clip-path="url(#clip-${b.id})"/>`)
      let y = r.y + pad + CARD_ACCENT
      const head = typeHeader(b, r.x + pad, y - 2, c.accent)
      parts.push(head.svg)
      y += head.h
      parts.push(typeFooter(b, r, surf.muted))
      const inner = r.w - pad * 2
      if (b.title) {
        const tl = wrapText(b.title, inner, CARD_TITLE_SIZE, true)
        parts.push(textLines(tl, r.x + pad, y, CARD_TITLE_SIZE, surf.ink, 600))
        y += tl.length * CARD_TITLE_SIZE * LINE_HEIGHT + 6
      }
      if (b.text) {
        const bl = wrapText(b.text, inner, CARD_BODY_SIZE)
        const collapsed = isCollapsed(b)
        const room = Math.max(1, collapsed ? Math.ceil((r.y + r.h - y) / (CARD_BODY_SIZE * LINE_HEIGHT)) : Math.floor((r.y + r.h - pad - y) / (CARD_BODY_SIZE * LINE_HEIGHT)))
        parts.push(`<g clip-path="url(#clip-${b.id})">${textLines(bl, r.x + pad, y, CARD_BODY_SIZE, surf.muted, 400, room, !collapsed)}</g>`)
        if (collapsed) parts.push(collapsedFade(b, r, surf.surface, surf.ink))
      }
    } else if (b.kind === 'text') {
      const fs = FONT_SIZES[b.size]
      const bold = b.size === 'l' || b.size === 'xl'
      parts.push(textLines(wrapText(b.text, r.w - 8, fs, bold), r.x, r.y, fs, surf.ink, bold ? 650 : 400))
    }
    parts.push(pendingOutline(b, r, b.kind === 'card' ? RADII.card : b.kind === 'frame' ? RADII.frame : RADII.sticky))
    if (b.rotation) parts.push('</g>')
  }

  const markers = `<marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1 L9 5 L1 9" fill="none" stroke="${surf.connector}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker>`
  // routing and labels only look at nearby blocks: query a grid, keeping the scope order the router relies on
  const obstacles = scope.filter((b) => b.kind !== 'frame')
  const grid = new SpatialGrid(512)
  const rank = new Map<string, number>()
  obstacles.forEach((b, i) => {
    grid.set(b.id, visual(b))
    rank.set(b.id, i)
  })
  const near = (area: Rect, skip: (string | null | undefined)[] = []) =>
    grid
      .query(area)
      .filter((id) => !skip.includes(id))
      .sort((p, q) => rank.get(p)! - rank.get(q)!)
      .map((id) => grid.get(id)!)
  for (const c of board.connectors.values()) {
    const fr = c.from ? rects.get(c.from) : null
    const tr = c.to ? rects.get(c.to) : null
    if ((c.from && !fr) || (c.to && !tr)) continue
    if (!fr && !tr && opts.ids?.length) continue
    const ends = [fr, tr, c.fromPoint && { ...c.fromPoint, w: 0, h: 0 }, c.toPoint && { ...c.toPoint, w: 0, h: 0 }, ...(c.waypoints ?? []).map((p) => ({ ...p, w: 0, h: 0 }))].filter(Boolean) as Rect[]
    const span = bboxOf(ends)
    // the orthogonal router looks 400px (+ stub and margin) around its ends; curves bulge with distance
    const reach = 440 + Math.max(span.w, span.h) / 2
    const obs = near({ x: span.x - reach, y: span.y - reach, w: span.w + reach * 2, h: span.h + reach * 2 }, [c.from, c.to])
    const route = routeConnector({
      from: fr ?? null,
      fromPoint: c.fromPoint,
      fromRotation: c.from ? board.blocks.get(c.from)?.rotation : 0,
      to: tr ?? null,
      toPoint: c.toPoint,
      toRotation: c.to ? board.blocks.get(c.to)?.rotation : 0,
      style: c.route,
      waypoints: c.waypoints,
      obstacles: obs,
    })
    if (!route) continue
    const stroke = c.pending ? (c.author?.color ?? surf.connector) : surf.connector
    parts.push(`<path d="${route.d}" stroke="${stroke}" stroke-width="1.6" fill="none" stroke-linecap="round" marker-end="url(#ah)" ${c.pending ? 'stroke-dasharray="5 4"' : ''}/>`)
    if (c.label) {
      const { w } = estimateLabelSize(c.label)
      const along = bboxOf(route.points.map((p) => ({ ...p, w: 0, h: 0 })))
      const { x: mx, y: my } = placeLabel(route, w, 22, near({ x: along.x - w, y: along.y - 22, w: along.w + w * 2, h: along.h + 44 }, [c.from, c.to]))
      parts.push(`<rect x="${mx - w / 2}" y="${my - 11}" width="${w}" height="22" rx="6" fill="${surf.canvas}"/>`)
      parts.push(`<text x="${mx}" y="${my + 4.5}" text-anchor="middle" font-size="13" fill="${surf.muted}">${esc(c.label)}</text>`)
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${vx} ${vy} ${W} ${H}" font-family="${esc(FONT)}"><defs>${markers}</defs>${parts.join('')}</svg>`
  if (opts.format === 'svg') return { svg, png: null, width: W, height: H }
  const zoom = Math.max(0.25, Math.min(2, 2400 / Math.max(W, H)))
  const raster = greekText(svg, zoom)
  const png = await rasterize(raster, {
    fitTo: { mode: 'zoom', value: zoom },
    font: { loadSystemFonts: raster.includes('<text'), defaultFontFamily: 'DejaVu Sans' },
  })
  return { svg, png, width: W, height: H }
}

// ---- rasterizing off the event loop --------------------------------------------------------------------------

type ResvgOptions = { fitTo: { mode: 'zoom'; value: number }; font: { loadSystemFonts: boolean; defaultFontFamily: string } }

// Inline so the bundled desktop core needs no extra file; resvg is loaded by absolute path.
const WORKER_SRC = `
const { parentPort, workerData } = require('node:worker_threads')
const { Resvg } = require(workerData)
parentPort.on('message', ({ id, svg, opts }) => {
  try {
    parentPort.postMessage({ id, png: new Resvg(svg, opts).render().asPng() })
  } catch (e) {
    parentPort.postMessage({ id, error: String((e && e.message) || e) })
  }
})`

let worker: Worker | null | undefined
let seq = 0
const jobs = new Map<number, { resolve: (b: Buffer) => void; reject: (e: Error) => void }>()

function rasterWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    const w = new Worker(WORKER_SRC, { eval: true, workerData: createRequire(import.meta.url).resolve('@resvg/resvg-js') })
    w.unref()
    w.on('message', (m: { id: number; png?: Uint8Array; error?: string }) => {
      const job = jobs.get(m.id)
      jobs.delete(m.id)
      if (!jobs.size) w.unref()
      if (m.error || !m.png) job?.reject(new Error(m.error ?? 'Rasterizing failed'))
      else job?.resolve(Buffer.from(m.png.buffer, m.png.byteOffset, m.png.byteLength))
    })
    w.on('error', (e) => {
      for (const j of jobs.values()) j.reject(e)
      jobs.clear()
      worker = undefined
    })
    worker = w
  } catch {
    worker = null
  }
  return worker
}

/** Render SVG to PNG in a worker thread so large boards don't stall live sync and other agents (inline fallback). */
async function rasterize(svg: string, opts: ResvgOptions): Promise<Buffer> {
  const w = rasterWorker()
  if (w) {
    const id = ++seq
    return new Promise<Buffer>((resolve, reject) => {
      jobs.set(id, { resolve, reject })
      w.ref()
      w.postMessage({ id, svg, opts })
    })
  }
  const { Resvg } = await import('@resvg/resvg-js')
  return new Resvg(svg, opts).render().asPng()
}
