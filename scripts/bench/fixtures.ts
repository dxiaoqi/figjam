// Deterministic large boards for `npm run bench`: frames, stickies, cards, text, typed blocks, images,
// inline web snippets and connectors (curved / elbow / labelled / relations).
import { PNG } from 'pngjs'
import { BLOCK_TYPES, cardContentHeight, measureCard, STICKY_SIZES, stickyContentHeight, type Block, type BlockTypeId, type Connector } from '@nodboard/shared'
import { Board } from '../../packages/core/src/board'

const WORDS = 'onboarding offline sync latency pricing churn trust delight search export template agent canvas review layout frame insight quote cluster metric roadmap feedback friction habit mobile desktop team share comment focus speed calm clarity'.split(' ')

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function png(w: number, h: number, hue: number) {
  const p = new PNG({ width: w, height: h })
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      p.data[i] = (hue + x * 3) & 255
      p.data[i + 1] = (hue * 2 + y * 3) & 255
      p.data[i + 2] = 180
      p.data[i + 3] = 255
    }
  return new Uint8Array(PNG.sync.write(p))
}

const SNIPPET = {
  html: '<main><h1>Pricing calculator</h1><input id="n" type="range" min="1" max="50" value="5"><p id="out"></p></main>',
  css: 'body{font:14px system-ui;margin:16px} h1{font-size:18px}',
  js: "const n=document.getElementById('n');const o=document.getElementById('out');const f=()=>o.textContent=`${n.value} seats · $${n.value*12}/mo`;n.oninput=f;f()",
}

export interface FixtureInfo {
  id: string
  title: string
  firstFrame: string
  blocks: number
  connectors: number
  frames: number
  images: number
  snippets: number
  typed: number
}

/** Build a board with exactly `total` blocks and save it under the current NODBOARD_HOME. */
export function buildBoard(total: number, seed = 42): FixtureInfo {
  const r = rng(seed)
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]
  const words = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(' ')
  const id = `bbench${total}`
  const board = new Board(id)
  const now = Date.now()
  const author = { kind: 'agent' as const, id: 'bench', name: 'Bench', color: '#6E56CF', client: 'bench' }
  const blocks: Block[] = []
  const connectors: Connector[] = []
  let n = 0
  const nextId = () => `k${(n++).toString(36).padStart(5, '0')}`
  const base = (kind: Block['kind'], x: number, y: number, w: number, h: number, parent: string | null): Block => ({
    id: nextId(), kind, x, y, w, h, parent, text: '', color: 'yellow', size: 'm', author, createdAt: now + n, updatedAt: now + n, pending: false, changeSet: null,
  })

  const assets = [0, 1, 2].map((i) => {
    const bytes = png(96, 64, i * 70)
    return { id: `abench${i}`, hash: board.store.put(bytes, 'png').hash, ext: 'png', mime: 'image/png', size: bytes.byteLength, role: 'image' as const, w: 96, h: 64, name: `bench-${i}.png`, createdAt: now }
  })
  const imageCount = Math.max(3, Math.round(total * 0.003))
  const snippetCount = Math.max(2, Math.round(total * 0.0006))
  const frameCount = Math.max(4, Math.round(total * 0.006))
  const perFrame = 60
  const typeIds = Object.keys(BLOCK_TYPES) as BlockTypeId[]
  let typed = 0

  const content = (parent: string | null, x: number, y: number): Block => {
    const roll = r()
    if (roll < 0.5) {
      const b = base('sticky', x, y, STICKY_SIZES.m, STICKY_SIZES.m, parent)
      b.text = words(3 + Math.floor(r() * 8))
      b.color = pick(['yellow', 'green', 'blue', 'pink', 'orange', 'purple'] as const)
      if (r() < 0.25) {
        const t = pick(typeIds)
        b.type = t
        b.typeData = { [t]: {} }
        b.color = BLOCK_TYPES[t].color
        typed++
      }
      b.contentH = Math.round(stickyContentHeight(b.text, b.w, b.type ? 44 : 0))
      return b
    }
    if (roll < 0.8) {
      const title = words(2 + Math.floor(r() * 3))
      const text = words(8 + Math.floor(r() * 16))
      const m = measureCard(title, text, 'm')
      const b = base('card', x, y, 280, Math.min(m.h, 176), parent)
      Object.assign(b, { title, text, color: pick(['blue', 'teal', 'gray', 'purple'] as const) })
      if (r() < 0.2) {
        b.type = 'hypothesis'
        b.typeData = { hypothesis: { status: pick(['unverified', 'supported', 'refuted']), confidence: 'medium' } }
        b.color = BLOCK_TYPES.hypothesis.color
        typed++
      }
      b.contentH = Math.round(cardContentHeight(title, text, 280))
      if (r() < 0.04) b.rotation = pick([-3, 2, 4])
      return b
    }
    const b = base('text', x, y, 240, 40, parent)
    b.text = words(2 + Math.floor(r() * 3))
    b.size = 'l'
    b.color = 'gray'
    return b
  }

  // frames: a 10-column grid of frames, each holding a 10×6 grid of content
  const cols = 10
  const cellW = 304
  const cellH = 208
  const frameW = 32 * 2 + 10 * cellW - 24
  const frameH = 32 * 2 + 6 * cellH - 24
  const frameIds: string[] = []
  for (let f = 0; f < frameCount && blocks.length < total; f++) {
    const fx = (f % cols) * (frameW + 160)
    const fy = Math.floor(f / cols) * (frameH + 160)
    const fr = base('frame', fx, fy, frameW, frameH, null)
    fr.title = `${words(2)} ${f + 1}`
    fr.color = 'gray'
    blocks.push(fr)
    frameIds.push(fr.id)
    const kids: Block[] = []
    for (let i = 0; i < perFrame && blocks.length < total - imageCount - snippetCount; i++) {
      const b = content(fr.id, 32 + (i % 10) * cellW, 32 + Math.floor(i / 10) * cellH)
      blocks.push(b)
      kids.push(b)
    }
    // connectors: chains along rows, some elbows between rows, a few labelled / typed relations
    for (let i = 0; i < kids.length - 1; i++) {
      if (i % 10 === 9) continue
      if (r() > 0.55) continue
      const c: Connector = { id: nextId(), from: kids[i].id, to: kids[i + 1].id, label: '', author, createdAt: now, updatedAt: now, pending: false, changeSet: null }
      const k = r()
      if (k < 0.2) c.route = 'elbow'
      else if (k < 0.3) c.route = 'straight'
      if (r() < 0.08) c.label = pick(['leads to', 'blocks', 'because', 'then'])
      else if (r() < 0.05) c.relation = 'supports'
      connectors.push(c)
    }
    for (let i = 0; i + 10 < kids.length; i += 7) {
      connectors.push({ id: nextId(), from: kids[i].id, to: kids[i + 10].id, route: 'elbow', label: '', author, createdAt: now, updatedAt: now, pending: false, changeSet: null })
    }
  }
  // loose content below the frames
  const looseTop = Math.ceil(frameCount / cols) * (frameH + 160) + 240
  let li = 0
  let prev: Block | null = null
  while (blocks.length < total - imageCount - snippetCount) {
    const b = content(null, (li % 40) * cellW, looseTop + Math.floor(li / 40) * cellH)
    blocks.push(b)
    if (prev && li % 40 !== 0 && r() < 0.25) connectors.push({ id: nextId(), from: prev.id, to: b.id, label: '', author, createdAt: now, updatedAt: now, pending: false, changeSet: null })
    prev = b
    li++
  }
  const mediaTop = looseTop + Math.ceil(li / 40) * cellH + 240
  for (let i = 0; i < imageCount; i++) {
    const b = base('image', (i % 20) * 360, mediaTop + Math.floor(i / 20) * 280, 320, 216, null)
    b.asset = assets[i % assets.length].id
    b.color = 'gray'
    blocks.push(b)
  }
  const snipTop = mediaTop + Math.ceil(imageCount / 20) * 280 + 80
  for (let i = 0; i < snippetCount; i++) {
    const b = base('web', i * 520, snipTop, 480, 320, null)
    const src = Object.fromEntries((['html', 'css', 'js'] as const).map((k) => {
      const bytes = new TextEncoder().encode(SNIPPET[k])
      const hash = board.store.put(bytes, k).hash
      const aid = `abench${k}`
      assets.push({ id: aid, hash, ext: k, mime: k === 'html' ? 'text/html' : k === 'css' ? 'text/css' : 'text/javascript', size: bytes.byteLength, role: `snippet-${k}` as never, w: 0, h: 0, name: k, createdAt: now })
      return [k, aid]
    }))
    b.web = { mode: 'inline', src, title: `Pricing calculator ${i + 1}` }
    b.text = b.web.title!
    b.color = 'gray'
    blocks.push(b)
  }

  board.doc.transact(() => {
    board.meta.set('title', `Bench ${total.toLocaleString('en')} blocks`)
    board.meta.set('createdAt', now)
    board.meta.set('updatedAt', now)
    board.meta.set('schema', '2.0')
    for (const a of assets) board.assets.set(a.id, a)
    for (const b of blocks) board.blocks.set(b.id, b)
    for (const c of connectors) board.connectors.set(c.id, c)
  })
  board.saveNow()
  return { id, title: board.title, firstFrame: frameIds[0], blocks: blocks.length, connectors: connectors.length, frames: frameIds.length, images: imageCount, snippets: snippetCount, typed }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sizes = process.argv.slice(2).map(Number).filter(Boolean)
  const out = (sizes.length ? sizes : [1000, 10000]).map((s) => buildBoard(s))
  console.log(JSON.stringify(out))
}
