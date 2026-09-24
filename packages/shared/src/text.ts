import {
  CARD_WIDTHS,
  FONT_SIZES,
  LINE_HEIGHT,
  SPACING,
  STICKY_SIZES,
  TEXT_MAX_WIDTH,
  snapUp,
  type SizeToken,
} from './tokens'
import { stripMarkdown } from './media'

const CJK = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/

/** Approximate advance width of a character in em (Inter-like metrics). */
function charEm(ch: string, bold: boolean) {
  let w: number
  if (CJK.test(ch)) w = 1
  else if (ch === ' ') w = 0.28
  else if (/[A-Z]/.test(ch)) w = 0.66
  else if (/[mwMW]/.test(ch)) w = 0.82
  else if (/[iljtf.,:;'!|]/.test(ch)) w = 0.3
  else if (/[0-9]/.test(ch)) w = 0.58
  else w = 0.54
  return bold ? w * 1.1 : w
}

export function measureWidth(text: string, fontSize: number, bold = false) {
  let em = 0
  for (const ch of text) em += charEm(ch, bold)
  return em * fontSize
}

/** Greedy word wrap. CJK characters can break anywhere. */
export function wrapText(text: string, maxWidth: number, fontSize: number, bold = false): string[] {
  const out: string[] = []
  for (const para of stripMarkdown(text ?? '').split('\n')) {
    if (!para) {
      out.push('')
      continue
    }
    const tokens = para.match(/[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]|\s+|[^\s\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]+/g) ?? []
    let line = ''
    let width = 0
    for (const tok of tokens) {
      const tw = measureWidth(tok, fontSize, bold)
      if (width + tw <= maxWidth || !line.trim()) {
        if (!line && /^\s+$/.test(tok)) continue
        if (tw > maxWidth && !CJK.test(tok)) {
          // hard-break very long words
          for (const ch of tok) {
            const cw = measureWidth(ch, fontSize, bold)
            if (width + cw > maxWidth && line) {
              out.push(line)
              line = ''
              width = 0
            }
            line += ch
            width += cw
          }
          continue
        }
        line += tok
        width += tw
      } else {
        out.push(line.trimEnd())
        if (/^\s+$/.test(tok)) {
          line = ''
          width = 0
        } else {
          line = tok
          width = tw
        }
      }
    }
    out.push(line.trimEnd())
  }
  return out
}

export function textBlockHeight(text: string, width: number, fontSize: number, bold = false) {
  const lines = wrapText(text, width, fontSize, bold).length
  return Math.ceil(lines * fontSize * LINE_HEIGHT)
}

/** Font size a sticky note uses for its text, shrinking with length. */
export function stickyFontSize(text: string, side: number) {
  const len = [...stripMarkdown(text ?? '')].reduce((n, ch) => n + (CJK.test(ch) ? 1.8 : 1), 0)
  const scale = side / 200
  if (len <= 44) return Math.round(20 * scale)
  if (len <= 90) return Math.round(17 * scale)
  if (len <= 160) return Math.round(15 * scale)
  return Math.round(13 * scale)
}

export const CARD_TITLE_SIZE = 16
export const CARD_BODY_SIZE = FONT_SIZES.s
export const CARD_ACCENT = 4
/** Long content: blocks grow to fit up to these limits, then collapse behind a "Show more". */
export const CARD_MAX_H = 480
export const STICKY_MAX_RATIO = 1.75

const CODE_SPAN = /`([^`]+)`/g
const MONO_EM = 0.6 * 0.86
const CODE_PAD_EM = 0.3 * 0.86

type Tok = { w: number; space: boolean; cjk: boolean }

/** Width tokens for one line of the Markdown subset (code spans are monospace + padded; other marks are stripped). */
function inlineTokens(line: string, fontSize: number, bold: boolean): Tok[] {
  const out: Tok[] = []
  const push = (text: string, mono: boolean) => {
    const parts = text.match(/[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]|\s+|[^\s\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]+/g) ?? []
    parts.forEach((p, i) => {
      const cjk = CJK.test(p)
      let w = mono && !cjk ? [...p].length * MONO_EM * fontSize : measureWidth(p, mono ? fontSize * 0.86 : fontSize, bold)
      if (mono && i === 0) w += CODE_PAD_EM * fontSize
      if (mono && i === parts.length - 1) w += CODE_PAD_EM * fontSize
      out.push({ w, space: /^\s+$/.test(p), cjk })
    })
  }
  let last = 0
  for (const m of line.matchAll(CODE_SPAN)) {
    push(stripMarkdown(line.slice(last, m.index)), false)
    push(m[1], true)
    last = m.index! + m[0].length
  }
  push(stripMarkdown(line.slice(last)), false)
  return out
}

function countLines(toks: Tok[], maxWidth: number) {
  let lines = 1
  let width = 0
  for (const t of toks) {
    if (t.space) {
      if (width > 0) width += t.w
      continue
    }
    if (width + t.w <= maxWidth || width === 0) {
      if (t.w > maxWidth) {
        // overflow-wrap: anywhere breaks long words / code
        lines += Math.ceil(t.w / maxWidth) - 1
        width = t.w % maxWidth
      } else width += t.w
    } else {
      lines++
      width = t.w > maxWidth ? t.w % maxWidth : t.w
      if (t.w > maxWidth) lines += Math.ceil(t.w / maxWidth) - 1
    }
  }
  return lines
}

/** Rendered height of Markdown-subset text (paragraphs, lists, code spans) at a width — mirrors the canvas CSS. */
export function richTextHeight(md: string, width: number, fontSize: number, bold = false) {
  return Math.ceil(richTextHeightRaw(md, width, fontSize, bold))
}

function richTextHeightRaw(md: string, width: number, fontSize: number, bold = false) {
  const lh = fontSize * LINE_HEIGHT
  let h = 0
  let inList = false
  for (const raw of (md ?? '').split('\n')) {
    const li = raw.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/)
    if (li && !inList) h += 0.3 * fontSize
    inList = !!li
    const w = li ? width - 1.25 * fontSize : width
    h += countLines(inlineTokens(li ? li[1] : raw, fontSize, bold), Math.max(24, w)) * lh
  }
  return h
}

/** Largest height a block may take before its content collapses behind "Show more". */
export function maxBlockHeight(kind: string, w: number, expanded?: boolean) {
  if (expanded) return Infinity
  if (kind === 'card') return CARD_MAX_H
  if (kind === 'sticky') return snapUp(w * STICKY_MAX_RATIO)
  return Infinity
}

/** Layout height for a block whose content needs `contentH` px. */
export function fitHeight(kind: string, w: number, contentH: number, expanded?: boolean) {
  const h = snapUp(Math.min(contentH, maxBlockHeight(kind, w, expanded)))
  if (kind === 'card') return Math.max(h, 88)
  if (kind === 'sticky') return Math.max(h, w)
  return Math.max(h, 24)
}

export function cardContentHeight(title: string, body: string, w: number) {
  const inner = w - SPACING.blockPadding * 2
  let h = SPACING.blockPadding + CARD_ACCENT
  if (title) h += richTextHeightRaw(title, inner, CARD_TITLE_SIZE, true)
  if (title && body) h += 6
  if (body) h += richTextHeightRaw(body, inner, CARD_BODY_SIZE)
  return Math.ceil(h + SPACING.blockPadding + 2)
}

export function measureCard(title: string, body: string, size: SizeToken, expanded?: boolean) {
  const w = CARD_WIDTHS[size]
  const contentH = cardContentHeight(title, body, w)
  return { w, h: fitHeight('card', w, contentH, expanded), contentH }
}

export function measureText(text: string, size: SizeToken) {
  const fs = FONT_SIZES[size]
  const bold = size === 'l' || size === 'xl'
  const natural = Math.max(...(text || ' ').split('\n').map((l) => measureWidth(stripMarkdown(l), fs, bold)))
  const w = snapUp(Math.min(TEXT_MAX_WIDTH[size], Math.max(natural + 16, 48)))
  const h = snapUp(richTextHeight(text || ' ', w - 8, fs, bold))
  return { w, h }
}

export function stickyContentHeight(text: string, side: number) {
  const pad = SPACING.blockPadding
  return richTextHeight(text || ' ', side - pad * 2, stickyFontSize(text, side)) + pad * 2
}

export function measureSticky(text: string, size: SizeToken, expanded?: boolean) {
  let s = size
  // bump to the next size when text is long rather than overflowing
  if (s === 's' && [...text].length > 70) s = 'm'
  if (s === 'm' && [...text].length > 150) s = 'l'
  const side = STICKY_SIZES[s]
  const contentH = stickyContentHeight(text, side)
  return { w: side, h: fitHeight('sticky', side, contentH, expanded), size: s, contentH }
}
