import { t } from '../i18n'
import type { ReactNode } from 'react'

/**
 * Blocks store rich text as a small Markdown subset in the Yjs document:
 * **bold**, *italic*, `code`, [link](url), "- " bullet lists and "1. " numbered lists.
 * Agents write it natively; the canvas renders it, and TipTap edits it WYSIWYG.
 */

const SAFE_URL = /^(https?:|mailto:)/i

interface Inline {
  type: 'text' | 'bold' | 'italic' | 'code' | 'link'
  text?: string
  href?: string
  children?: Inline[]
}

function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let i = 0
  let buf = ''
  const flush = () => {
    if (buf) out.push({ type: 'text', text: buf })
    buf = ''
  }
  while (i < src.length) {
    const rest = src.slice(i)
    let m: RegExpMatchArray | null
    if ((m = rest.match(/^`([^`]+)`/))) {
      flush()
      out.push({ type: 'code', text: m[1] })
      i += m[0].length
    } else if ((m = rest.match(/^\*\*(.+?)\*\*/)) || (m = rest.match(/^__(.+?)__/))) {
      flush()
      out.push({ type: 'bold', children: parseInline(m[1]) })
      i += m[0].length
    } else if ((m = rest.match(/^\*(?!\s)(.+?)(?<!\s)\*/)) || (m = rest.match(/^_(?!\s)(.+?)(?<!\s)_(?!\w)/))) {
      flush()
      out.push({ type: 'italic', children: parseInline(m[1]) })
      i += m[0].length
    } else if ((m = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/))) {
      flush()
      out.push({ type: 'link', href: m[2], children: parseInline(m[1]) })
      i += m[0].length
    } else {
      buf += src[i]
      i++
    }
  }
  flush()
  return out
}

type Blockish = { type: 'p'; text: string } | { type: 'ul' | 'ol'; items: string[] }

function parseBlocks(md: string): Blockish[] {
  const out: Blockish[] = []
  for (const line of (md ?? '').split('\n')) {
    const ul = line.match(/^\s*[-*+]\s+(.*)$/)
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)
    const last = out[out.length - 1]
    if (ul) {
      if (last?.type === 'ul') last.items.push(ul[1])
      else out.push({ type: 'ul', items: [ul[1]] })
    } else if (ol) {
      if (last?.type === 'ol') last.items.push(ol[1])
      else out.push({ type: 'ol', items: [ol[1]] })
    } else out.push({ type: 'p', text: line })
  }
  return out
}

function renderInline(nodes: Inline[], key = 'i'): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}${i}`
    switch (n.type) {
      case 'text':
        return n.text
      case 'code':
        return <code key={k}>{n.text}</code>
      case 'bold':
        return <strong key={k}>{renderInline(n.children!, k)}</strong>
      case 'italic':
        return <em key={k}>{renderInline(n.children!, k)}</em>
      case 'link':
        return SAFE_URL.test(n.href!) ? (
          <a key={k} href={n.href} target="_blank" rel="noopener noreferrer" title={t('block.linkTitle', { href: n.href ?? '' })}>
            {renderInline(n.children!, k)}
          </a>
        ) : (
          <span key={k}>{renderInline(n.children!, k)}</span>
        )
    }
  })
}

/** Markdown → React (no innerHTML). */
export function renderMarkdown(md: string): ReactNode {
  return parseBlocks(md).map((b, i) => {
    if (b.type === 'p') return <p key={i}>{b.text ? renderInline(parseInline(b.text)) : <br />}</p>
    const items = b.items.map((it, j) => <li key={j}>{renderInline(parseInline(it))}</li>)
    return b.type === 'ul' ? <ul key={i}>{items}</ul> : <ol key={i}>{items}</ol>
  })
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inlineHtml(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case 'text':
          return esc(n.text!)
        case 'code':
          return `<code>${esc(n.text!)}</code>`
        case 'bold':
          return `<strong>${inlineHtml(n.children!)}</strong>`
        case 'italic':
          return `<em>${inlineHtml(n.children!)}</em>`
        case 'link':
          return SAFE_URL.test(n.href!) ? `<a href="${esc(n.href!)}">${inlineHtml(n.children!)}</a>` : inlineHtml(n.children!)
      }
    })
    .join('')
}

/** Markdown → HTML for loading into TipTap. */
export function mdToHtml(md: string): string {
  return parseBlocks(md)
    .map((b) => {
      if (b.type === 'p') return `<p>${inlineHtml(parseInline(b.text))}</p>`
      const items = b.items.map((it) => `<li><p>${inlineHtml(parseInline(it))}</p></li>`).join('')
      return b.type === 'ul' ? `<ul>${items}</ul>` : `<ol>${items}</ol>`
    })
    .join('')
}

interface PMNode {
  type: string
  text?: string
  content?: PMNode[]
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

function inlineMd(nodes: PMNode[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '\n'
      if (n.type !== 'text') return ''
      let t = n.text ?? ''
      const marks = n.marks ?? []
      if (marks.some((m) => m.type === 'code')) return `\`${t}\``
      if (marks.some((m) => m.type === 'bold')) t = `**${t}**`
      if (marks.some((m) => m.type === 'italic')) t = `*${t}*`
      const link = marks.find((m) => m.type === 'link')
      if (link) t = `[${t}](${link.attrs?.href ?? ''})`
      return t
    })
    .join('')
    .replace(/\*\*\*\*/g, '')
}

/** TipTap JSON → Markdown (the stored form). */
export function docToMarkdown(doc: PMNode): string {
  const lines: string[] = []
  for (const node of doc.content ?? []) {
    if (node.type === 'paragraph') lines.push(inlineMd(node.content))
    else if (node.type === 'bulletList' || node.type === 'orderedList') {
      ;(node.content ?? []).forEach((li, i) => {
        const text = (li.content ?? []).map((p) => inlineMd(p.content)).join(' ')
        lines.push(node.type === 'bulletList' ? `- ${text}` : `${i + 1}. ${text}`)
      })
    }
  }
  return lines.join('\n').replace(/\n+$/, '')
}
