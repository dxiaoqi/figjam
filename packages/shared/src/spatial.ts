import type { Rect as Box } from './model'

const OFFSET = 1 << 15
const key = (cx: number, cy: number) => (cx + OFFSET) * 65536 + (cy + OFFSET)

/**
 * Uniform-grid spatial hash of axis-aligned boxes. Each cell also has a version that changes whenever a box
 * enters, leaves or moves within it, so callers can cache results that depend on "what is in this area".
 */
export class SpatialGrid {
  private cells = new Map<number, Set<string>>()
  private versions = new Map<number, number>()
  private boxes = new Map<string, Box>()
  private seq = 0

  constructor(readonly cellSize = 512) {}

  get size() {
    return this.boxes.size
  }

  get(id: string) {
    return this.boxes.get(id)
  }

  private range(b: Box) {
    const s = this.cellSize
    return [Math.floor(b.x / s), Math.floor(b.y / s), Math.floor((b.x + Math.max(0, b.w)) / s), Math.floor((b.y + Math.max(0, b.h)) / s)]
  }

  private touch(k: number) {
    this.versions.set(k, ++this.seq)
  }

  set(id: string, b: Box) {
    const prev = this.boxes.get(id)
    if (prev && prev.x === b.x && prev.y === b.y && prev.w === b.w && prev.h === b.h) return
    if (prev) this.remove(id, prev)
    this.boxes.set(id, b)
    const [x1, y1, x2, y2] = this.range(b)
    for (let cx = x1; cx <= x2; cx++)
      for (let cy = y1; cy <= y2; cy++) {
        const k = key(cx, cy)
        let cell = this.cells.get(k)
        if (!cell) this.cells.set(k, (cell = new Set()))
        cell.add(id)
        this.touch(k)
      }
  }

  delete(id: string) {
    const prev = this.boxes.get(id)
    if (!prev) return
    this.remove(id, prev)
    this.boxes.delete(id)
  }

  private remove(id: string, b: Box) {
    const [x1, y1, x2, y2] = this.range(b)
    for (let cx = x1; cx <= x2; cx++)
      for (let cy = y1; cy <= y2; cy++) {
        const k = key(cx, cy)
        const cell = this.cells.get(k)
        if (!cell) continue
        cell.delete(id)
        if (!cell.size) this.cells.delete(k)
        this.touch(k)
      }
  }

  /** Ids whose boxes intersect `b` (edges touching don't count). */
  query(b: Box): string[] {
    const out: string[] = []
    const [x1, y1, x2, y2] = this.range(b)
    const bx2 = b.x + b.w
    const by2 = b.y + b.h
    // far-zoom viewports cover more cells than there are boxes: a straight scan is cheaper
    if ((x2 - x1 + 1) * (y2 - y1 + 1) > this.boxes.size) {
      for (const [id, r] of this.boxes) if (r.x < bx2 && r.x + r.w > b.x && r.y < by2 && r.y + r.h > b.y) out.push(id)
      return out
    }
    const seen = x1 === x2 && y1 === y2 ? null : new Set<string>()
    for (let cx = x1; cx <= x2; cx++)
      for (let cy = y1; cy <= y2; cy++) {
        const cell = this.cells.get(key(cx, cy))
        if (!cell) continue
        for (const id of cell) {
          if (seen) {
            if (seen.has(id)) continue
            seen.add(id)
          }
          const r = this.boxes.get(id)!
          if (r.x < bx2 && r.x + r.w > b.x && r.y < by2 && r.y + r.h > b.y) out.push(id)
        }
      }
    return out
  }

  /** Changes whenever anything in the cells covering `b` changes. */
  version(b: Box): string {
    const [x1, y1, x2, y2] = this.range(b)
    let v = ''
    for (let cx = x1; cx <= x2; cx++) for (let cy = y1; cy <= y2; cy++) v += `${this.versions.get(key(cx, cy)) ?? 0},`
    return v
  }
}
