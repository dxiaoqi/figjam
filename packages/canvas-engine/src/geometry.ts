export interface Vec {
  x: number
  y: number
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h })

export function boxFromPoints(a: Vec, b: Vec): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}

export function union(boxes: Box[]): Box | null {
  if (!boxes.length) return null
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const b of boxes) {
    x1 = Math.min(x1, b.x)
    y1 = Math.min(y1, b.y)
    x2 = Math.max(x2, b.x + b.w)
    y2 = Math.max(y2, b.y + b.h)
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

export function intersects(a: Box, b: Box) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

export function containsBox(outer: Box, inner: Box) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
}

export function containsPoint(b: Box, p: Vec, pad = 0) {
  return p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad
}

export const center = (b: Box): Vec => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

export function expand(b: Box, by: number): Box {
  return { x: b.x - by, y: b.y - by, w: b.w + by * 2, h: b.h + by * 2 }
}

/** Where the segment from the box center toward `toward` leaves the box (plus padding). */
export function edgePoint(b: Box, toward: Vec, pad = 0): Vec {
  const c = center(b)
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (!dx && !dy) return c
  const sx = (b.w / 2 + pad) / Math.abs(dx || 1e-9)
  const sy = (b.h / 2 + pad) / Math.abs(dy || 1e-9)
  const s = Math.min(sx, sy)
  return { x: c.x + dx * s, y: c.y + dy * s }
}

export function distToSegment(p: Vec, a: Vec, b: Vec) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0
  const x = a.x + t * dx
  const y = a.y + t * dy
  return Math.hypot(p.x - x, p.y - y)
}

export const snapTo = (v: number, step: number) => Math.round(v / step) * step

export function randomId() {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz'
  let s = ''
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  for (const b of bytes) s += chars[b % 36]
  return s
}
