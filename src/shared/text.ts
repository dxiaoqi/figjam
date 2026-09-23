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
  for (const para of (text ?? '').split('\n')) {
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
  const len = [...(text ?? '')].reduce((n, ch) => n + (CJK.test(ch) ? 1.8 : 1), 0)
  const scale = side / 200
  if (len <= 32) return Math.round(20 * scale)
  if (len <= 80) return Math.round(17 * scale)
  if (len <= 150) return Math.round(15 * scale)
  return Math.round(13 * scale)
}

export const CARD_TITLE_SIZE = 16
export const CARD_BODY_SIZE = FONT_SIZES.s
export const CARD_ACCENT = 4

export function measureCard(title: string, body: string, size: SizeToken) {
  const w = CARD_WIDTHS[size]
  const inner = w - SPACING.blockPadding * 2
  let h = SPACING.blockPadding + CARD_ACCENT
  if (title) h += textBlockHeight(title, inner, CARD_TITLE_SIZE, true)
  if (title && body) h += 6
  if (body) h += textBlockHeight(body, inner, CARD_BODY_SIZE)
  h += SPACING.blockPadding
  return { w, h: Math.max(snapUp(h), 88) }
}

export function measureText(text: string, size: SizeToken) {
  const fs = FONT_SIZES[size]
  const bold = size === 'l' || size === 'xl'
  const natural = Math.max(...(text || ' ').split('\n').map((l) => measureWidth(l, fs, bold)))
  const w = snapUp(Math.min(TEXT_MAX_WIDTH[size], Math.max(natural + 16, 48)))
  const h = snapUp(textBlockHeight(text || ' ', w - 8, fs, bold))
  return { w, h }
}

export function measureSticky(text: string, size: SizeToken) {
  let s = size
  // bump to the next size when text is long rather than overflowing
  if (s === 's' && [...text].length > 70) s = 'm'
  if (s === 'm' && [...text].length > 150) s = 'l'
  const side = STICKY_SIZES[s]
  return { w: side, h: side, size: s }
}
