import type { Block, Rect } from '@aifig/shared'
import { SPACING, snap } from '@aifig/shared'
import { cardContentHeight, maxBlockHeight, richTextHeight, stickyContentHeight, measureCard, measureText, typeChrome } from '@aifig/shared'
import { FONT_SIZES } from '@aifig/shared'

export type LayoutIntent = 'grid' | 'row' | 'stack' | 'cluster' | 'tree' | 'matrix' | 'timeline' | 'flow'

export interface LayoutItem {
  key: string
  kind: Block['kind']
  w: number
  h: number
  group?: string
  parentKey?: string
  /** matrix */
  row?: string
  col?: string
  /** timeline */
  date?: string
}

export interface Placed {
  x: number
  y: number
  w: number
  h: number
}

export interface LayoutResult {
  placed: Map<string, Placed>
  headings: { group: string; x: number; y: number; small?: boolean }[]
  edges: [string, string][]
}

const GAP = SPACING.gap
const CLUSTER_GAP = SPACING.clusterGap

export function autoColumns(n: number) {
  if (n <= 3) return n
  if (n === 4) return 2
  return Math.min(6, Math.ceil(Math.sqrt(n * 1.5)))
}

function grid(items: LayoutItem[], columns?: number, x0 = 0, y0 = 0): Map<string, Placed> {
  const out = new Map<string, Placed>()
  if (!items.length) return out
  const cols = Math.max(1, Math.min(columns ?? autoColumns(items.length), items.length))
  const colW = Math.max(...items.map((i) => i.w))
  let y = y0
  for (let r = 0; r * cols < items.length; r++) {
    const row = items.slice(r * cols, r * cols + cols)
    const rowH = Math.max(...row.map((i) => i.h))
    row.forEach((it, c) => {
      out.set(it.key, { x: x0 + c * (colW + GAP), y, w: it.w, h: it.kind === 'card' ? rowH : it.h })
    })
    y += rowH + GAP
  }
  return out
}

function row(items: LayoutItem[], x0 = 0, y0 = 0) {
  const out = new Map<string, Placed>()
  const cardH = Math.max(0, ...items.filter((i) => i.kind === 'card').map((i) => i.h))
  let x = x0
  for (const it of items) {
    out.set(it.key, { x, y: y0, w: it.w, h: it.kind === 'card' ? cardH : it.h })
    x += it.w + GAP
  }
  return out
}

function stack(items: LayoutItem[], x0 = 0, y0 = 0, gap = GAP) {
  const out = new Map<string, Placed>()
  let y = y0
  for (const it of items) {
    out.set(it.key, { x: x0, y, w: it.w, h: it.h })
    y += it.h + gap
  }
  return out
}

function cluster(items: LayoutItem[], headingSize: (g: string) => { w: number; h: number }): LayoutResult {
  const groups = new Map<string, LayoutItem[]>()
  for (const it of items) {
    const g = it.group?.trim() || 'Other'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(it)
  }
  const placed = new Map<string, Placed>()
  const headings: LayoutResult['headings'] = []
  let x = 0
  for (const [g, members] of groups) {
    const hs = headingSize(g)
    headings.push({ group: g, x, y: 0 })
    const top = snap(hs.h + 16)
    const cols = members.length > 6 ? 2 : 1
    const sub = grid(members, cols, x, top)
    let right = x + hs.w
    for (const [k, p] of sub) {
      placed.set(k, p)
      right = Math.max(right, p.x + p.w)
    }
    x = right + CLUSTER_GAP
  }
  return { placed, headings, edges: [] }
}

function tree(items: LayoutItem[], direction: 'right' | 'down'): LayoutResult {
  const byKey = new Map(items.map((i) => [i.key, i]))
  const children = new Map<string, LayoutItem[]>()
  const roots: LayoutItem[] = []
  const edges: [string, string][] = []
  for (const it of items) {
    if (it.parentKey && byKey.has(it.parentKey)) {
      if (!children.has(it.parentKey)) children.set(it.parentKey, [])
      children.get(it.parentKey)!.push(it)
      edges.push([it.parentKey, it.key])
    } else roots.push(it)
  }
  const horizontal = direction === 'right'
  const LEVEL_GAP = 80
  // cross-axis extent of each subtree
  const ext = new Map<string, number>()
  const measure = (n: LayoutItem): number => {
    const own = horizontal ? n.h : n.w
    const kids = children.get(n.key) ?? []
    const kidsExt = kids.reduce((s, k) => s + measure(k), 0) + Math.max(0, kids.length - 1) * GAP
    const e = Math.max(own, kidsExt)
    ext.set(n.key, e)
    return e
  }
  roots.forEach(measure)
  // main-axis offset per depth = max size at previous depths
  const depthSize: number[] = []
  const walkDepth = (n: LayoutItem, d: number) => {
    depthSize[d] = Math.max(depthSize[d] ?? 0, horizontal ? n.w : n.h)
    for (const k of children.get(n.key) ?? []) walkDepth(k, d + 1)
  }
  roots.forEach((r) => walkDepth(r, 0))
  const depthOffset = depthSize.map((_, d) => depthSize.slice(0, d).reduce((s, v) => s + v + LEVEL_GAP, 0))

  const placed = new Map<string, Placed>()
  const place = (n: LayoutItem, d: number, crossStart: number) => {
    const e = ext.get(n.key)!
    const own = horizontal ? n.h : n.w
    const cross = snap(crossStart + (e - own) / 2)
    const main = depthOffset[d]
    placed.set(n.key, horizontal ? { x: main, y: cross, w: n.w, h: n.h } : { x: cross, y: main, w: n.w, h: n.h })
    const kids = children.get(n.key) ?? []
    const kidsExt = kids.reduce((s, k) => s + ext.get(k.key)!, 0) + Math.max(0, kids.length - 1) * GAP
    let c = crossStart + (e - kidsExt) / 2
    for (const k of kids) {
      place(k, d + 1, c)
      c += ext.get(k.key)! + GAP
    }
  }
  let cursor = 0
  for (const r of roots) {
    place(r, 0, cursor)
    cursor += ext.get(r.key)! + CLUSTER_GAP
  }
  return { placed, headings: [], edges }
}

/** Compare timeline labels: real dates, then quarters / versions / numbers, then text. */
export function compareDates(a?: string, b?: string) {
  if (a === b) return 0
  if (!a) return 1
  if (!b) return -1
  const t = (s: string) => {
    const q = s.match(/^Q([1-4])\s*(\d{4})$|^(\d{4})\s*Q([1-4])$/i)
    if (q) return new Date(Number(q[2] ?? q[3]), (Number(q[1] ?? q[4]) - 1) * 3, 1).getTime()
    const d = Date.parse(/^\d{4}-\d{2}$/.test(s) ? `${s}-01` : s)
    return Number.isNaN(d) ? null : d
  }
  const ta = t(a)
  const tb = t(b)
  if (ta !== null && tb !== null) return ta - tb
  return a.localeCompare(b, undefined, { numeric: true })
}

/** Rows × columns with small axis labels; several blocks in a cell stack. */
function matrix(items: LayoutItem[], labelSize: (g: string) => { w: number; h: number }): LayoutResult {
  const rows = [...new Set(items.map((i) => i.row?.trim() || '—'))]
  const cols = [...new Set(items.map((i) => i.col?.trim() || '—'))]
  const rowOf = (i: LayoutItem) => i.row?.trim() || '—'
  const colOf = (i: LayoutItem) => i.col?.trim() || '—'
  const labelW = snap(Math.max(80, ...rows.map((r) => labelSize(r).w)) + GAP)
  const headH = snap(Math.max(...cols.map((c) => labelSize(c).h)) + 12)
  const colW = cols.map((c) => Math.max(labelSize(c).w, ...items.filter((i) => colOf(i) === c).map((i) => i.w)))
  const colX: number[] = []
  let x = labelW
  for (const w of colW) {
    colX.push(x)
    x += w + GAP
  }
  const placed = new Map<string, Placed>()
  const headings: LayoutResult['headings'] = cols.map((c, i) => ({ group: c, x: colX[i], y: 0, small: true }))
  let y = headH
  for (const r of rows) {
    headings.push({ group: r, x: 0, y, small: true })
    let rowH = 0
    cols.forEach((c, ci) => {
      let cy = y
      for (const it of items.filter((i) => rowOf(i) === r && colOf(i) === c)) {
        placed.set(it.key, { x: colX[ci], y: snap(cy), w: it.w, h: it.h })
        cy += it.h + GAP
      }
      rowH = Math.max(rowH, cy - y - GAP)
    })
    y = snap(y + Math.max(rowH, 40) + CLUSTER_GAP / 2)
  }
  return { placed, headings, edges: [] }
}

/** Left to right in date order, a label above each block, joined by arrows. */
function timeline(items: LayoutItem[], labelSize: (g: string) => { w: number; h: number }): LayoutResult {
  const sorted = items.map((it, i) => ({ it, i })).sort((a, b) => compareDates(a.it.date, b.it.date) || a.i - b.i).map((x) => x.it)
  const headH = snap(Math.max(24, ...sorted.map((i) => labelSize(i.date ?? '').h)) + 8)
  const placed = new Map<string, Placed>()
  const headings: LayoutResult['headings'] = []
  let x = 0
  for (const it of sorted) {
    if (it.date) headings.push({ group: it.date, x, y: 0, small: true })
    placed.set(it.key, { x, y: headH, w: it.w, h: it.h })
    x = snap(x + Math.max(it.w, labelSize(it.date ?? '').w) + CLUSTER_GAP)
  }
  const edges: [string, string][] = sorted.slice(1).map((it, i) => [sorted[i].key, it.key])
  return { placed, headings, edges }
}

/** Steps in order, left to right, wrapping into rows; each step points to the next. */
function flow(items: LayoutItem[], columns = 5): LayoutResult {
  const placed = new Map<string, Placed>()
  const cols = Math.max(1, Math.min(columns, items.length))
  const rowH: number[] = []
  items.forEach((it, i) => (rowH[Math.floor(i / cols)] = Math.max(rowH[Math.floor(i / cols)] ?? 0, it.h)))
  const colW = Math.max(...items.map((i) => i.w))
  items.forEach((it, i) => {
    const r = Math.floor(i / cols)
    const c = i % cols
    const y = rowH.slice(0, r).reduce((a, h) => a + h + CLUSTER_GAP, 0)
    placed.set(it.key, { x: snap(c * (colW + CLUSTER_GAP)), y: snap(y), w: it.w, h: it.h })
  })
  const edges: [string, string][] = items.slice(1).map((it, i) => [items[i].key, it.key])
  return { placed, headings: [], edges }
}

export function layout(
  items: LayoutItem[],
  intent: LayoutIntent,
  opts: { columns?: number; direction?: 'right' | 'down'; headingSize: (g: string) => { w: number; h: number }; labelSize?: (g: string) => { w: number; h: number } },
): LayoutResult {
  switch (intent) {
    case 'row':
      return { placed: row(items), headings: [], edges: [] }
    case 'stack':
      return { placed: stack(items), headings: [], edges: [] }
    case 'cluster':
      return cluster(items, opts.headingSize)
    case 'tree':
      return tree(items, opts.direction ?? 'right')
    case 'matrix':
      return matrix(items, opts.labelSize ?? opts.headingSize)
    case 'timeline':
      return timeline(items, opts.labelSize ?? opts.headingSize)
    case 'flow':
      return flow(items, opts.columns)
    default:
      return { placed: grid(items, opts.columns), headings: [], edges: [] }
  }
}

export function bboxOf(rects: Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, w: 0, h: 0 }
  let x = Infinity
  let y = Infinity
  let r = -Infinity
  let b = -Infinity
  for (const q of rects) {
    if (q.x < x) x = q.x
    if (q.y < y) y = q.y
    if (q.x + q.w > r) r = q.x + q.w
    if (q.y + q.h > b) b = q.y + q.h
  }
  return { x, y, w: r - x, h: b - y }
}

export function intersects(a: Rect, b: Rect, margin = 0) {
  return a.x < b.x + b.w + margin && a.x + a.w + margin > b.x && a.y < b.y + b.h + margin && a.y + a.h + margin > b.y
}

/** Find a free top-left for a box of `size`, preferring the visible viewport, else right of existing content. */
export function findFreeSpot(occupied: Rect[], size: { w: number; h: number }, viewport: Rect | null) {
  const margin = CLUSTER_GAP
  if (viewport) {
    const inset = 64
    const step = 32
    for (let y = viewport.y + inset; y + size.h <= viewport.y + viewport.h - inset / 2; y += step) {
      for (let x = viewport.x + inset; x + size.w <= viewport.x + viewport.w - inset / 2; x += step) {
        const cand = { x, y, w: size.w, h: size.h }
        if (!occupied.some((o) => intersects(cand, o, margin))) return { x: snap(x), y: snap(y) }
      }
    }
  }
  if (!occupied.length) {
    if (viewport) return { x: snap(viewport.x + viewport.w / 2 - size.w / 2), y: snap(viewport.y + viewport.h / 2 - size.h / 2) }
    return { x: 0, y: 0 }
  }
  const bb = bboxOf(occupied)
  const y = viewport ? Math.max(bb.y, Math.min(viewport.y + 64, bb.y + bb.h)) : bb.y
  return { x: snap(bb.x + bb.w + margin * 1.5), y: snap(y) }
}

// ---- measurement ----------------------------------------------------------

export function measureBlock(b: Pick<Block, 'kind' | 'text' | 'title' | 'size' | 'w' | 'h'> & Pick<Partial<Block>, 'expanded' | 'type' | 'typeData'>): { w: number; h: number } {
  switch (b.kind) {
    case 'card':
      return measureCard(b.title ?? '', b.text ?? '', b.size, b.expanded, typeChrome(b))
    case 'text':
      return measureText(b.text ?? '', b.size)
    default:
      return { w: b.w, h: b.h }
  }
}

// ---- tidy ---------------------------------------------------------------

/**
 * Tidy a set of siblings: group into rows by vertical position, left-align rows,
 * even gaps, snap to grid. Returns new relative positions.
 */
export function tidyPositions(items: Block[], origin: { x: number; y: number }) {
  const out = new Map<string, { x: number; y: number }>()
  if (!items.length) return out
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
  const rows: Block[][] = []
  let cur: Block[] = []
  let rowTop = 0
  let rowH = 0
  for (const b of sorted) {
    if (cur.length && b.y >= rowTop + rowH * 0.5) {
      rows.push(cur)
      cur = []
    }
    if (!cur.length) {
      rowTop = b.y
      rowH = b.h
    } else rowH = Math.max(rowH, b.y + b.h - rowTop)
    cur.push(b)
  }
  if (cur.length) rows.push(cur)
  const gapFor = (a: Block, b: Block) => (a.kind === 'frame' || b.kind === 'frame' ? CLUSTER_GAP : GAP)
  let y = snap(origin.y)
  let prevRow: Block[] | null = null
  for (const r of rows) {
    r.sort((a, b) => a.x - b.x)
    if (prevRow) {
      const g = prevRow.some((b) => b.kind === 'frame') || r.some((b) => b.kind === 'frame') ? CLUSTER_GAP : GAP
      y += g
    }
    let x = snap(origin.x)
    let maxH = 0
    r.forEach((b, i) => {
      if (i > 0) x += gapFor(r[i - 1], b)
      out.set(b.id, { x, y })
      x += b.w
      maxH = Math.max(maxH, b.h)
    })
    y += maxH
    prevRow = r
  }
  return out
}

// ---- lint ---------------------------------------------------------------

export interface LintIssue {
  severity: 'error' | 'warning'
  rule: 'overlap' | 'text-overflow' | 'outside-frame' | 'off-grid' | 'too-many-colors' | 'empty-block'
  ids: string[]
  message: string
}

/** Height the content needs: the canvas-measured value when known, else a Markdown-aware estimate. */
export function contentHeight(b: Block) {
  if (b.contentH != null) return b.contentH
  if (b.kind === 'sticky') return stickyContentHeight(b.text, b.w, typeChrome(b))
  if (b.kind === 'card') return cardContentHeight(b.title ?? '', b.text ?? '', b.w, typeChrome(b))
  if (b.kind === 'text') return richTextHeight(b.text, b.w - 8, FONT_SIZES[b.size], b.size === 'l' || b.size === 'xl')
  return 0
}

export function lintBlocks(all: Block[], scope: Block[], label: (b: Block) => string): LintIssue[] {
  const issues: LintIssue[] = []
  const byParent = new Map<string, Block[]>()
  for (const b of scope) {
    const k = b.parent ?? ''
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k)!.push(b)
  }
  for (const [, sibs] of byParent) {
    // sweep along x; pairs are reported in the same (i, j) order as a pairwise scan
    const byX = sibs.map((b, i) => ({ b, i })).sort((p, q) => p.b.x - q.b.x)
    const pairs: [number, number][] = []
    for (let s = 0; s < byX.length; s++) {
      const { b: a, i } = byX[s]
      for (let t = s + 1; t < byX.length && byX[t].b.x < a.x + a.w - 1; t++) {
        const { b, i: j } = byX[t]
        if (intersects(a, b, -1)) pairs.push(i < j ? [i, j] : [j, i])
      }
    }
    pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1])
    for (const [i, j] of pairs) issues.push({ severity: 'error', rule: 'overlap', ids: [sibs[i].id, sibs[j].id], message: `${label(sibs[i])} overlaps ${label(sibs[j])}` })
  }
  const frames = new Map(all.filter((b) => b.kind === 'frame').map((f) => [f.id, f]))
  const inScope = new Set(scope.map((b) => b.id))
  const scopeParents = new Set(scope.map((b) => b.parent).filter(Boolean))
  const kidColors = new Map<string, Set<string>>()
  for (const b of all) {
    if (!b.parent || b.kind === 'text') continue
    let s = kidColors.get(b.parent)
    if (!s) kidColors.set(b.parent, (s = new Set()))
    s.add(b.color)
  }
  for (const b of scope) {
    if (b.kind !== 'frame') {
      // content taller than the block is fine once it's at its max height (it collapses behind "Show more"); below that it's clipped
      const need = contentHeight(b)
      if (need > b.h + 4 && b.h < maxBlockHeight(b.kind, b.w, b.expanded) - 8) {
        issues.push({ severity: 'warning', rule: 'text-overflow', ids: [b.id], message: `${label(b)} text is clipped (needs ~${Math.round(need)}px, has ${b.h}px). Let it grow or shorten it.` })
      }
      if (!b.text?.trim() && !b.title?.trim() && b.kind !== 'web' && b.kind !== 'image') {
        issues.push({ severity: 'warning', rule: 'empty-block', ids: [b.id], message: `${label(b)} is empty` })
      }
    }
    if (b.parent) {
      const f = frames.get(b.parent)
      if (f && (b.x < 0 || b.y < 0 || b.x + b.w > f.w || b.y + b.h > f.h)) {
        issues.push({ severity: 'error', rule: 'outside-frame', ids: [b.id, f.id], message: `${label(b)} sticks out of frame "${f.title}"` })
      }
    }
    if (b.x % 8 || b.y % 8) {
      issues.push({ severity: 'warning', rule: 'off-grid', ids: [b.id], message: `${label(b)} is off the 8px grid` })
    }
  }
  for (const f of frames.values()) {
    if (!inScope.has(f.id) && !scopeParents.has(f.id)) continue
    const colors = kidColors.get(f.id) ?? new Set()
    if (colors.size > 4) {
      issues.push({ severity: 'warning', rule: 'too-many-colors', ids: [f.id], message: `Frame "${f.title}" uses ${colors.size} colors; keep it to 4 or fewer` })
    }
  }
  return issues
}

