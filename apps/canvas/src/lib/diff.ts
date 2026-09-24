import { stripMarkdown, type Block } from '@aifig/shared'

export type DiffPart = { kind: 'same' | 'add' | 'del'; text: string }

const TOKEN = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]|\s+|[^\s\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]+/g

/** Word-level diff (CJK per character) via LCS. Good enough for block-sized text. */
export function diffWords(before: string, after: string): DiffPart[] {
  const a = before.match(TOKEN) ?? []
  const b = after.match(TOKEN) ?? []
  if (a.length * b.length > 250_000) return [{ kind: 'del', text: before }, { kind: 'add', text: after }]
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: DiffPart[] = []
  const push = (kind: DiffPart['kind'], text: string) => {
    const last = out[out.length - 1]
    if (last?.kind === kind) last.text += text
    else out.push({ kind, text })
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', a[i++])
    else push('add', b[j++])
  }
  while (i < a.length) push('del', a[i++])
  while (j < b.length) push('add', b[j++])
  return out
}

export type FieldChange =
  | { field: 'text' | 'title' | 'source'; parts: DiffPart[] }
  | { field: 'moved'; dx: number; dy: number }
  | { field: 'resized'; from: string; to: string }
  | { field: 'color' | 'size' | 'rotation' | 'frame' | 'url'; from: string; to: string }

/** What changed between a block's snapshot before the change set and now. */
export function blockChanges(before: Block, after: Block, frameTitle: (id?: string | null) => string): FieldChange[] {
  const out: FieldChange[] = []
  const bw = before.web
  const aw = after.web
  if (bw && aw) {
    if ((bw.url ?? '') !== (aw.url ?? '')) out.push({ field: 'url', from: bw.url ?? 'inline', to: aw.url ?? 'inline' })
    const src = (w: typeof bw) => (w.mode === 'inline' ? [w.html && `<!-- html -->\n${w.html}`, w.css && `/* css */\n${w.css}`, w.js && `// js\n${w.js}`].filter(Boolean).join('\n') : '')
    if (src(bw) !== src(aw)) out.push({ field: 'source', parts: diffWords(src(bw), src(aw)) })
    if ((bw.title ?? '') !== (aw.title ?? '')) out.push({ field: 'title', parts: diffWords(bw.title ?? '', aw.title ?? '') })
    return out
  }
  if ((before.title ?? '') !== (after.title ?? '')) out.push({ field: 'title', parts: diffWords(before.title ?? '', after.title ?? '') })
  if (before.text !== after.text) {
    const [a, b] = [stripMarkdown(before.text), stripMarkdown(after.text)]
    out.push({ field: 'text', parts: a === b ? diffWords(before.text, after.text) : diffWords(a, b) })
  }
  if ((before.parent ?? null) !== (after.parent ?? null)) out.push({ field: 'frame', from: frameTitle(before.parent), to: frameTitle(after.parent) })
  else if (before.x !== after.x || before.y !== after.y) out.push({ field: 'moved', dx: after.x - before.x, dy: after.y - before.y })
  if (before.w !== after.w || before.h !== after.h) out.push({ field: 'resized', from: `${before.w}×${before.h}`, to: `${after.w}×${after.h}` })
  if (before.color !== after.color) out.push({ field: 'color', from: before.color, to: after.color })
  if (before.size !== after.size) out.push({ field: 'size', from: before.size, to: after.size })
  if ((before.rotation ?? 0) !== (after.rotation ?? 0)) out.push({ field: 'rotation', from: `${before.rotation ?? 0}°`, to: `${after.rotation ?? 0}°` })
  return out
}
