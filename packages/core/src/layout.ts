import type { Block, Rect } from '@aifig/shared'
import { SPACING, snap } from '@aifig/shared'
import { stickyFontSize, textBlockHeight, measureCard, measureText } from '@aifig/shared'
import { FONT_SIZES } from '@aifig/shared'

export type LayoutIntent = 'grid' | 'row' | 'stack' | 'cluster' | 'tree'

export interface LayoutItem {
  key: string
  kind: Block['kind']
  w: number
  h: number
  group?: string
  parentKey?: string
}

export interface Placed {
  x: number
  y: number
  w: number
  h: number
}

export interface LayoutResult {
  placed: Map<string, Placed>
  headings: { group: string; x: number; y: number }[]
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

export function layout(
  items: LayoutItem[],
  intent: LayoutIntent,
  opts: { columns?: number; direction?: 'right' | 'down'; headingSize: (g: string) => { w: number; h: number } },
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
    default:
      return { placed: grid(items, opts.columns), headings: [], edges: [] }
  }
}

export function bboxOf(rects: Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, w: 0, h: 0 }
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  const r = Math.max(...rects.map((r) => r.x + r.w))
  const b = Math.max(...rects.map((r) => r.y + r.h))
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

export function measureBlock(b: Pick<Block, 'kind' | 'text' | 'title' | 'size' | 'w' | 'h'>): { w: number; h: number } {
  switch (b.kind) {
    case 'card':
      return measureCard(b.title ?? '', b.text ?? '', b.size)
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

function estimatedContentHeight(b: Block) {
  const pad = SPACING.blockPadding
  if (b.kind === 'sticky') {
    const fs = stickyFontSize(b.text, b.w)
    return textBlockHeight(b.text, b.w - pad * 2, fs) + pad * 2
  }
  if (b.kind === 'card') {
    return measureCard(b.title ?? '', b.text ?? '', b.size).h
  }
  if (b.kind === 'text') {
    return textBlockHeight(b.text, b.w - 8, FONT_SIZES[b.size], b.size === 'l' || b.size === 'xl')
  }
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
    for (let i = 0; i < sibs.length; i++) {
      for (let j = i + 1; j < sibs.length; j++) {
        const a = sibs[i]
        const b = sibs[j]
        if (intersects(a, b, -1)) {
          issues.push({ severity: 'error', rule: 'overlap', ids: [a.id, b.id], message: `${label(a)} overlaps ${label(b)}` })
        }
      }
    }
  }
  const frames = new Map(all.filter((b) => b.kind === 'frame').map((f) => [f.id, f]))
  for (const b of scope) {
    if (b.kind !== 'frame') {
      const need = estimatedContentHeight(b)
      if (need > b.h + 4) {
        issues.push({ severity: 'warning', rule: 'text-overflow', ids: [b.id], message: `${label(b)} text likely overflows (needs ~${Math.round(need)}px, has ${b.h}px). Shorten it or use size "l".` })
      }
      if (!b.text?.trim() && !b.title?.trim()) {
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
    if (!scope.includes(f) && !scope.some((b) => b.parent === f.id)) continue
    const colors = new Set(all.filter((b) => b.parent === f.id && b.kind !== 'text').map((b) => b.color))
    if (colors.size > 4) {
      issues.push({ severity: 'warning', rule: 'too-many-colors', ids: [f.id], message: `Frame "${f.title}" uses ${colors.size} colors; keep it to 4 or fewer` })
    }
  }
  return issues
}

