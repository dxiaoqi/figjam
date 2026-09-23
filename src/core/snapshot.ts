import type { Block, Connector, Rect } from '../shared/model'
import { CARD_ACCENT, CARD_BODY_SIZE, CARD_TITLE_SIZE, stickyFontSize, wrapText } from '../shared/text'
import { COLORS, FONT_SIZES, LINE_HEIGHT, RADII, SPACING, SURFACES } from '../shared/tokens'
import type { Board } from './board'
import { bboxOf } from './layout'

const FONT = `Inter, 'PingFang SC', 'Noto Sans CJK SC', 'Microsoft YaHei', 'DejaVu Sans', sans-serif`

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function textLines(lines: string[], x: number, y: number, fs: number, fill: string, weight = 400, maxLines = 99) {
  const lh = fs * LINE_HEIGHT
  const shown = lines.slice(0, maxLines)
  if (lines.length > maxLines && shown.length) shown[shown.length - 1] = `${shown[shown.length - 1].replace(/.{0,2}$/, '')}…`
  return shown
    .map((l, i) => `<text x="${x}" y="${(y + fs + i * lh - (lh - fs) * 0.1).toFixed(1)}" font-size="${fs}" font-weight="${weight}" fill="${fill}">${esc(l)}</text>`)
    .join('')
}

/** Point where the segment from the rect center toward `to` exits the rect. */
function edgePoint(r: Rect, to: { x: number; y: number }, pad = 4) {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const dx = to.x - cx
  const dy = to.y - cy
  if (!dx && !dy) return { x: cx, y: cy }
  const sx = (r.w / 2 + pad) / Math.abs(dx || 1e-9)
  const sy = (r.h / 2 + pad) / Math.abs(dy || 1e-9)
  const s = Math.min(sx, sy)
  return { x: cx + dx * s, y: cy + dy * s }
}

export async function renderSnapshot(
  board: Board,
  opts: { frameId?: string; theme: 'light' | 'dark'; format: 'png' | 'svg' },
) {
  const theme = opts.theme
  const surf = SURFACES[theme]
  const all = [...board.blocks.values()]
  const scope = opts.frameId ? all.filter((b) => b.id === opts.frameId || b.parent === opts.frameId) : all
  const rects = new Map<string, Rect>(scope.map((b) => [b.id, board.pageRect(b)]))
  const margin = 48
  const bb = scope.length ? bboxOf([...rects.values()]) : { x: 0, y: 0, w: 480, h: 280 }
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
    if (b.kind === 'frame') {
      parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${RADII.frame}" fill="${surf.frame}" stroke="${surf.border}" stroke-width="1"/>`)
      parts.push(`<text x="${r.x + 2}" y="${r.y - 10}" font-size="14" font-weight="600" fill="${surf.muted}">${esc(b.title ?? '')}</text>`)
    } else if (b.kind === 'sticky') {
      const fs = stickyFontSize(b.text, b.w)
      parts.push(`<rect x="${r.x}" y="${r.y + 2}" width="${r.w}" height="${r.h}" rx="${RADII.sticky}" fill="#000" opacity="${theme === 'light' ? 0.06 : 0.25}"/>`)
      parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${RADII.sticky}" fill="${c.bg}"/>`)
      const lines = wrapText(b.text, r.w - pad * 2, fs)
      parts.push(textLines(lines, r.x + pad, r.y + pad, fs, c.ink, 450, Math.floor((r.h - pad * 2) / (fs * LINE_HEIGHT))))
    } else if (b.kind === 'card') {
      parts.push(`<rect x="${r.x}" y="${r.y + 1}" width="${r.w}" height="${r.h}" rx="${RADII.card}" fill="#000" opacity="${theme === 'light' ? 0.05 : 0.3}"/>`)
      parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${RADII.card}" fill="${surf.surface}" stroke="${surf.border}"/>`)
      parts.push(`<clipPath id="clip-${b.id}"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${RADII.card}"/></clipPath>`)
      parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${CARD_ACCENT}" fill="${c.accent}" clip-path="url(#clip-${b.id})"/>`)
      let y = r.y + pad + CARD_ACCENT
      const inner = r.w - pad * 2
      if (b.title) {
        const tl = wrapText(b.title, inner, CARD_TITLE_SIZE, true)
        parts.push(textLines(tl, r.x + pad, y, CARD_TITLE_SIZE, surf.ink, 600))
        y += tl.length * CARD_TITLE_SIZE * LINE_HEIGHT + 6
      }
      if (b.text) {
        const bl = wrapText(b.text, inner, CARD_BODY_SIZE)
        const room = Math.max(1, Math.floor((r.y + r.h - pad - y) / (CARD_BODY_SIZE * LINE_HEIGHT)))
        parts.push(textLines(bl, r.x + pad, y, CARD_BODY_SIZE, surf.muted, 400, room))
      }
    } else if (b.kind === 'text') {
      const fs = FONT_SIZES[b.size]
      const bold = b.size === 'l' || b.size === 'xl'
      parts.push(textLines(wrapText(b.text, r.w - 8, fs, bold), r.x, r.y, fs, surf.ink, bold ? 650 : 400))
    }
    parts.push(pendingOutline(b, r, b.kind === 'card' ? RADII.card : b.kind === 'frame' ? RADII.frame : RADII.sticky))
  }

  const markers = `<marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1 L9 5 L1 9" fill="none" stroke="${surf.connector}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker>`
  for (const c of board.connectors.values()) {
    const fr = c.from ? rects.get(c.from) : null
    const tr = c.to ? rects.get(c.to) : null
    if ((c.from && !fr) || (c.to && !tr)) continue
    const fc = fr ? { x: fr.x + fr.w / 2, y: fr.y + fr.h / 2 } : c.fromPoint
    const tc = tr ? { x: tr.x + tr.w / 2, y: tr.y + tr.h / 2 } : c.toPoint
    if (!fc || !tc) continue
    const p1 = fr ? edgePoint(fr, tc) : fc
    const p2 = tr ? edgePoint(tr, fc, 6) : tc
    const stroke = c.pending ? (c.author?.color ?? surf.connector) : surf.connector
    parts.push(`<path d="M${p1.x.toFixed(1)} ${p1.y.toFixed(1)} L${p2.x.toFixed(1)} ${p2.y.toFixed(1)}" stroke="${stroke}" stroke-width="1.6" fill="none" marker-end="url(#ah)" ${c.pending ? 'stroke-dasharray="5 4"' : ''}/>`)
    if (c.label) {
      const mx = (p1.x + p2.x) / 2
      const my = (p1.y + p2.y) / 2
      const w = c.label.length * 7 + 16
      parts.push(`<rect x="${mx - w / 2}" y="${my - 11}" width="${w}" height="22" rx="6" fill="${surf.canvas}"/>`)
      parts.push(`<text x="${mx}" y="${my + 4.5}" text-anchor="middle" font-size="13" fill="${surf.muted}">${esc(c.label)}</text>`)
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${vx} ${vy} ${W} ${H}" font-family="${esc(FONT)}"><defs>${markers}</defs>${parts.join('')}</svg>`
  if (opts.format === 'svg') return { svg, png: null, width: W, height: H }
  const { Resvg } = await import('@resvg/resvg-js')
  const scale = Math.min(2, 2400 / Math.max(W, H))
  const png = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: Math.max(0.25, scale) },
    font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' },
  })
    .render()
    .asPng()
  return { svg, png, width: W, height: H }
}
