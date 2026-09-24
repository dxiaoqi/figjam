import { callCore } from './core'

type Item = { id: string; content_h?: number; expanded?: boolean }

const queues = new Map<string, Map<string, Item>>()
let timer: ReturnType<typeof setTimeout> | null = null

async function flush() {
  timer = null
  const batches = [...queues.entries()]
  queues.clear()
  for (const [board, items] of batches) {
    if (!items.size) continue
    try {
      await callCore('report_layout', { board, items: [...items.values()] })
    } catch {
      // the block may have been deleted meanwhile; the next render re-measures
    }
  }
}

/** Tell the core what the canvas actually rendered (batched), so layout, make-room and lint use real heights. */
export function reportLayout(board: string, item: Item, immediate = false) {
  const q = queues.get(board) ?? new Map<string, Item>()
  q.set(item.id, { ...q.get(item.id), ...item })
  queues.set(board, q)
  if (timer) clearTimeout(timer)
  timer = setTimeout(flush, immediate ? 0 : 120)
}
