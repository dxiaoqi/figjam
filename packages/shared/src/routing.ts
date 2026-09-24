/**
 * Connector routing shared by the canvas engine and the core's snapshot renderer.
 * Styles: straight (center line clipped to edges), curved (bezier between edge midpoints, falls back to a
 * rounded obstacle-avoiding path), elbow (orthogonal, obstacle-avoiding A* on a sparse grid).
 */

export type RouteStyle = 'straight' | 'curved' | 'elbow'
export const ROUTE_STYLES: RouteStyle[] = ['curved', 'elbow', 'straight']
export const DEFAULT_ROUTE: RouteStyle = 'curved'

interface P {
  x: number
  y: number
}
interface R {
  x: number
  y: number
  w: number
  h: number
}
type Side = 'top' | 'right' | 'bottom' | 'left'

export interface RouteInput {
  from: R | null
  fromPoint?: P | null
  /** Rotation of the `from` block in degrees (around its center). */
  fromRotation?: number
  to: R | null
  toPoint?: P | null
  toRotation?: number
  /** Manual waypoints (page space) for elbow routes. */
  waypoints?: P[] | null
  style?: RouteStyle | null
  /** Blocks the route should avoid (curved / elbow). Endpoints' own blocks are excluded by the caller. */
  obstacles?: R[]
}

export interface Route {
  /** SVG path data. */
  d: string
  /** Polyline approximation, for hit-testing and label placement. */
  points: P[]
  start: P
  end: P
  /** Point halfway along the route (label anchor). */
  mid: P
}

const NORMAL: Record<Side, P> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } }
const START_GAP = 4
const END_GAP = 7
const STUB = 20
const MARGIN = 14

const center = (r: R): P => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

export function rotatePoint(p: P, c: P, deg: number): P {
  if (!deg) return p
  const a = (deg * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const dx = p.x - c.x
  const dy = p.y - c.y
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos }
}

/** Axis-aligned bounds of a rect rotated around its center. */
export function rotatedBounds(r: R, deg?: number): R {
  if (!deg) return r
  const c = center(r)
  const pts = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x, y: r.y + r.h },
    { x: r.x + r.w, y: r.y + r.h },
  ].map((p) => rotatePoint(p, c, deg))
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

function sideAnchor(r: R, side: Side, gap: number): P {
  const c = center(r)
  switch (side) {
    case 'top':
      return { x: c.x, y: r.y - gap }
    case 'bottom':
      return { x: c.x, y: r.y + r.h + gap }
    case 'left':
      return { x: r.x - gap, y: c.y }
    case 'right':
      return { x: r.x + r.w + gap, y: c.y }
  }
}

function sideToward(r: R, p: P): Side {
  const c = center(r)
  const dx = (p.x - c.x) / Math.max(r.w, 1)
  const dy = (p.y - c.y) / Math.max(r.h, 1)
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'bottom' : 'top'
}

function pickSides(a: R, b: R): [Side, Side] {
  const hGap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w))
  const vGap = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h))
  const ca = center(a)
  const cb = center(b)
  if (hGap >= 24 && (hGap >= vGap || vGap < 24)) return cb.x > ca.x ? ['right', 'left'] : ['left', 'right']
  if (vGap >= 24) return cb.y > ca.y ? ['bottom', 'top'] : ['top', 'bottom']
  // overlapping or very close: go around the dominant axis
  return Math.abs(cb.x - ca.x) > Math.abs(cb.y - ca.y) ? (cb.x > ca.x ? ['right', 'left'] : ['left', 'right']) : cb.y > ca.y ? ['bottom', 'top'] : ['top', 'bottom']
}

function edgePoint(r: R, toward: P, pad: number): P {
  const c = center(r)
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (!dx && !dy) return c
  const s = Math.min((r.w / 2 + pad) / Math.abs(dx || 1e-9), (r.h / 2 + pad) / Math.abs(dy || 1e-9))
  return { x: c.x + dx * s, y: c.y + dy * s }
}

const inflate = (r: R, m: number): R => ({ x: r.x - m, y: r.y - m, w: r.w + m * 2, h: r.h + m * 2 })
const strictlyInside = (p: P, r: R) => p.x > r.x + 0.01 && p.x < r.x + r.w - 0.01 && p.y > r.y + 0.01 && p.y < r.y + r.h - 0.01

function segmentHits(a: P, b: P, r: R) {
  // axis-aligned segments only
  if (a.y === b.y) {
    if (a.y <= r.y + 0.01 || a.y >= r.y + r.h - 0.01) return false
    const x1 = Math.min(a.x, b.x)
    const x2 = Math.max(a.x, b.x)
    return x2 > r.x + 0.01 && x1 < r.x + r.w - 0.01
  }
  if (a.x <= r.x + 0.01 || a.x >= r.x + r.w - 0.01) return false
  const y1 = Math.min(a.y, b.y)
  const y2 = Math.max(a.y, b.y)
  return y2 > r.y + 0.01 && y1 < r.y + r.h - 0.01
}

/** Orthogonal route from s (leaving along ns) to e (arriving against ne), avoiding boxes. */
function orthogonalRoute(s: P, ns: P, e: P, ne: P, boxes: R[]): P[] {
  const s1 = { x: s.x + ns.x * STUB, y: s.y + ns.y * STUB }
  const e1 = { x: e.x + ne.x * STUB, y: e.y + ne.y * STUB }
  const area = { x: Math.min(s1.x, e1.x) - 400, y: Math.min(s1.y, e1.y) - 400, w: Math.abs(s1.x - e1.x) + 800, h: Math.abs(s1.y - e1.y) + 800 }
  const obs = boxes
    .map((b) => inflate(b, MARGIN))
    .filter((b) => b.x < area.x + area.w && b.x + b.w > area.x && b.y < area.y + area.h && b.y + b.h > area.y && !strictlyInside(s1, b) && !strictlyInside(e1, b))
    .slice(0, 40)
  const xsSet = new Set([s1.x, e1.x, (s1.x + e1.x) / 2])
  const ysSet = new Set([s1.y, e1.y, (s1.y + e1.y) / 2])
  for (const o of obs) {
    xsSet.add(o.x)
    xsSet.add(o.x + o.w)
    ysSet.add(o.y)
    ysSet.add(o.y + o.h)
  }
  const xs = [...xsSet].sort((a, b) => a - b)
  const ys = [...ysSet].sort((a, b) => a - b)
  const W = xs.length
  const H = ys.length
  const idx = (i: number, j: number) => j * W + i
  const blocked = new Uint8Array(W * H)
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (obs.some((o) => strictlyInside({ x: xs[i], y: ys[j] }, o))) blocked[idx(i, j)] = 1
  const si = xs.indexOf(s1.x)
  const sj = ys.indexOf(s1.y)
  const ei = xs.indexOf(e1.x)
  const ej = ys.indexOf(e1.y)
  const BEND = 40
  // state: node * 4 directions (0 right, 1 down, 2 left, 3 up)
  const DIRS = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ]
  const dirOf = (n: P) => (n.x > 0 ? 0 : n.y > 0 ? 1 : n.x < 0 ? 2 : 3)
  const startDir = dirOf(ns)
  const endDir = dirOf({ x: -ne.x, y: -ne.y })
  const N = W * H * 4
  const dist = new Float64Array(N).fill(Infinity)
  const prev = new Int32Array(N).fill(-1)
  const open: [number, number][] = []
  const h = (i: number, j: number) => Math.abs(xs[i] - xs[ei]) + Math.abs(ys[j] - ys[ej])
  const push = (state: number, f: number) => {
    open.push([f, state])
    let k = open.length - 1
    while (k > 0) {
      const p = (k - 1) >> 1
      if (open[p][0] <= open[k][0]) break
      ;[open[p], open[k]] = [open[k], open[p]]
      k = p
    }
  }
  const pop = () => {
    const top = open[0]
    const last = open.pop()!
    if (open.length) {
      open[0] = last
      let k = 0
      for (;;) {
        const l = k * 2 + 1
        const r = l + 1
        let m = k
        if (l < open.length && open[l][0] < open[m][0]) m = l
        if (r < open.length && open[r][0] < open[m][0]) m = r
        if (m === k) break
        ;[open[m], open[k]] = [open[k], open[m]]
        k = m
      }
    }
    return top
  }
  const s0 = idx(si, sj) * 4 + startDir
  dist[s0] = 0
  push(s0, h(si, sj))
  let found = -1
  let guard = 0
  while (open.length && guard++ < 60000) {
    const [, st] = pop()
    const node = st >> 2
    const d = st & 3
    const i = node % W
    const j = (node / W) | 0
    if (i === ei && j === ej) {
      found = st
      break
    }
    for (let nd = 0; nd < 4; nd++) {
      if ((nd + 2) % 4 === d) continue
      const ni = i + DIRS[nd][0]
      const nj = j + DIRS[nd][1]
      if (ni < 0 || nj < 0 || ni >= W || nj >= H || blocked[idx(ni, nj)]) continue
      const a = { x: xs[i], y: ys[j] }
      const b = { x: xs[ni], y: ys[nj] }
      if (obs.some((o) => segmentHits(a, b, o))) continue
      let cost = dist[st] + Math.abs(b.x - a.x) + Math.abs(b.y - a.y) + (nd !== d ? BEND : 0)
      if (ni === ei && nj === ej && nd !== endDir) cost += BEND
      const ns2 = idx(ni, nj) * 4 + nd
      if (cost < dist[ns2]) {
        dist[ns2] = cost
        prev[ns2] = st
        push(ns2, cost + h(ni, nj))
      }
    }
  }
  if (found < 0) {
    // fallback: simple three-segment elbow
    const horizontal = Math.abs(ns.x) > 0
    const mid = horizontal ? { a: { x: (s1.x + e1.x) / 2, y: s1.y }, b: { x: (s1.x + e1.x) / 2, y: e1.y } } : { a: { x: s1.x, y: (s1.y + e1.y) / 2 }, b: { x: e1.x, y: (s1.y + e1.y) / 2 } }
    return simplify([s, s1, mid.a, mid.b, e1, e])
  }
  const path: P[] = []
  for (let st = found; st >= 0; st = prev[st]) {
    const node = st >> 2
    path.push({ x: xs[node % W], y: ys[(node / W) | 0] })
  }
  path.reverse()
  return simplify([s, ...path, e])
}

function simplify(pts: P[]): P[] {
  const out: P[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue
    out.push(p)
  }
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1]
    const b = out[i]
    const c = out[i + 1]
    const collinear = (Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01) || (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01)
    if (collinear) out.splice(i, 1)
  }
  return out
}

function roundedPath(pts: P[], radius: number): string {
  if (pts.length < 3) return `M${f(pts[0].x)} ${f(pts[0].y)}` + pts.slice(1).map((p) => ` L${f(p.x)} ${f(p.y)}`).join('')
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const c = pts[i + 1]
    const l1 = Math.hypot(b.x - a.x, b.y - a.y)
    const l2 = Math.hypot(c.x - b.x, c.y - b.y)
    const r = Math.min(radius, l1 / 2, l2 / 2)
    const p1 = { x: b.x + ((a.x - b.x) / (l1 || 1)) * r, y: b.y + ((a.y - b.y) / (l1 || 1)) * r }
    const p2 = { x: b.x + ((c.x - b.x) / (l2 || 1)) * r, y: b.y + ((c.y - b.y) / (l2 || 1)) * r }
    d += ` L${f(p1.x)} ${f(p1.y)} Q${f(b.x)} ${f(b.y)} ${f(p2.x)} ${f(p2.y)}`
  }
  const e = pts[pts.length - 1]
  return `${d} L${f(e.x)} ${f(e.y)}`
}

const f = (n: number) => Math.round(n * 10) / 10

function midpointOf(pts: P[]): P {
  let total = 0
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  let half = total / 2
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (half <= seg) {
      const t = seg ? half / seg : 0
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t }
    }
    half -= seg
  }
  return pts[pts.length - 1] ?? { x: 0, y: 0 }
}

function bezierPoints(p0: P, p1: P, p2: P, p3: P, n = 24): P[] {
  const out: P[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    })
  }
  return out
}

function polylineHits(pts: P[], boxes: R[]) {
  return pts.some((p) => boxes.some((b) => strictlyInside(p, inflate(b, 2))))
}

export function routeConnector(input: RouteInput): Route | null {
  const style = input.style ?? DEFAULT_ROUTE
  const { from, to } = input
  const fromC = from ? center(from) : input.fromPoint
  const toC = to ? center(to) : input.toPoint
  if (!fromC || !toC) return null
  const obstacles = input.obstacles ?? []

  const fromRot = input.fromRotation ?? 0
  const toRot = input.toRotation ?? 0
  const rotEdge = (r: R, rot: number, toward: P, gap: number) => {
    const c = center(r)
    return rotatePoint(edgePoint(r, rotatePoint(toward, c, -rot), gap), c, rot)
  }

  if (style === 'straight') {
    const a = from ? rotEdge(from, fromRot, toC, START_GAP) : fromC
    const b = to ? rotEdge(to, toRot, fromC, END_GAP) : toC
    const points = [a, b]
    return { d: `M${f(a.x)} ${f(a.y)} L${f(b.x)} ${f(b.y)}`, points, start: a, end: b, mid: midpointOf(points) }
  }

  let sa: Side
  let sb: Side
  if (from && to && !fromRot && !toRot) [sa, sb] = pickSides(from, to)
  else {
    sa = from ? sideToward(from, rotatePoint(toC, fromC, -fromRot)) : 'right'
    sb = to ? sideToward(to, rotatePoint(fromC, toC, -toRot)) : 'left'
  }
  const rotN = (n: P, rot: number) => rotatePoint(n, { x: 0, y: 0 }, rot)
  const a = from ? rotatePoint(sideAnchor(from, sa, START_GAP), fromC, fromRot) : fromC
  const b = to ? rotatePoint(sideAnchor(to, sb, END_GAP), toC, toRot) : toC
  const dirToward = (p: P, q: P): P => (Math.abs(q.x - p.x) >= Math.abs(q.y - p.y) ? { x: Math.sign(q.x - p.x) || 1, y: 0 } : { x: 0, y: Math.sign(q.y - p.y) || 1 })
  const axisOf = (n: P): P => (Math.abs(n.x) >= Math.abs(n.y) ? { x: Math.sign(n.x) || 1, y: 0 } : { x: 0, y: Math.sign(n.y) || 1 })
  const naTrue = from ? rotN(NORMAL[sa], fromRot) : dirToward(a, b)
  const nbTrue = to ? rotN(NORMAL[sb], toRot) : dirToward(b, a)
  // orthogonal routing needs axis-aligned normals; curves keep the true (rotated) ones
  const na = style === 'elbow' ? axisOf(naTrue) : naTrue
  const nb = style === 'elbow' ? axisOf(nbTrue) : nbTrue

  if (style === 'curved') {
    const dist = Math.hypot(b.x - a.x, b.y - a.y)
    const k = Math.max(32, Math.min(160, dist * 0.45))
    const c1 = { x: a.x + na.x * k, y: a.y + na.y * k }
    const c2 = { x: b.x + nb.x * k, y: b.y + nb.y * k }
    const pts = bezierPoints(a, c1, c2, b)
    if (!obstacles.length || !polylineHits(pts, obstacles)) {
      return { d: `M${f(a.x)} ${f(a.y)} C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(b.x)} ${f(b.y)}`, points: pts, start: a, end: b, mid: midpointOf(pts) }
    }
    const route = orthogonalRoute(a, na, b, nb, obstacles)
    return { d: roundedPath(route, 28), points: route, start: a, end: b, mid: midpointOf(route) }
  }

  const wps = input.waypoints ?? []
  const route = wps.length ? waypointRoute(a, na, b, nb, wps) : orthogonalRoute(a, na, b, nb, obstacles)
  return { d: roundedPath(route, 8), points: route, start: a, end: b, mid: midpointOf(route) }
}

/** Orthogonal path through manual waypoints (the user overrides obstacle avoidance). */
function waypointRoute(s: P, ns: P, e: P, ne: P, wps: P[]): P[] {
  const s1 = { x: s.x + ns.x * STUB, y: s.y + ns.y * STUB }
  const e1 = { x: e.x + ne.x * STUB, y: e.y + ne.y * STUB }
  const pts: P[] = [s, s1]
  let horizontal = ns.x !== 0
  let cur = s1
  for (const q of [...wps, e1]) {
    if (Math.abs(q.x - cur.x) > 0.01 && Math.abs(q.y - cur.y) > 0.01) {
      // turn once: continue along the current axis, then switch
      pts.push(horizontal ? { x: q.x, y: cur.y } : { x: cur.x, y: q.y })
      horizontal = !horizontal
    } else horizontal = Math.abs(q.y - cur.y) <= 0.01
    pts.push(q)
    cur = q
  }
  pts.push(e)
  return simplify(pts)
}

/** Control polyline of a connector: its ends plus manual waypoints (for waypoint handles). */
export function controlPoints(route: Route, waypoints?: P[] | null): P[] {
  return [route.start, ...(waypoints ?? []), route.end]
}

/** Label anchor along the route that avoids overlapping blocks, preferring the middle. */
export function placeLabel(route: Route, w: number, h: number, obstacles: R[]): P {
  const pts = route.points
  const lengths = [0]
  for (let i = 1; i < pts.length; i++) lengths.push(lengths[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  const total = lengths[lengths.length - 1]
  if (!total || !obstacles.length) return route.mid
  const at = (t: number): P => {
    const d = t * total
    for (let i = 1; i < pts.length; i++) {
      if (d <= lengths[i]) {
        const seg = lengths[i] - lengths[i - 1] || 1
        const k = (d - lengths[i - 1]) / seg
        return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k }
      }
    }
    return pts[pts.length - 1]
  }
  const hits = (p: P) => obstacles.some((o) => p.x + w / 2 > o.x && p.x - w / 2 < o.x + o.w && p.y + h / 2 > o.y && p.y - h / 2 < o.y + o.h)
  for (let k = 0; k <= 9; k++) {
    for (const t of k === 0 ? [0.5] : [0.5 - k * 0.05, 0.5 + k * 0.05]) {
      const p = at(t)
      if (!hits(p)) return p
    }
  }
  return route.mid
}

export function estimateLabelSize(label: string) {
  return { w: [...label].reduce((n, ch) => n + (/[\u2E80-\u9FFF]/.test(ch) ? 13 : 7), 0) + 16, h: 22 }
}

export function distanceToRoute(p: P, route: Route) {
  let best = Infinity
  const pts = route.points
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = dx * dx + dy * dy
    const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)))
  }
  return best
}
