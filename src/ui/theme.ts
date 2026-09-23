import { COLORS, COLOR_TOKENS, SURFACES } from '@/shared/tokens'

/** Turn the shared design tokens into CSS variables so the canvas and the core render identically. */
export function installTokenStyles() {
  const rules: string[] = []
  const surf = (t: 'light' | 'dark') =>
    `--surface:${SURFACES[t].surface};--ink:${SURFACES[t].ink};--border-c:${SURFACES[t].border};--muted-c:${SURFACES[t].muted};--canvas:${SURFACES[t].canvas};--grid-dot:${t === 'light' ? 'rgb(28 25 23 / 0.13)' : 'rgb(255 255 255 / 0.08)'};`
  rules.push(`.tl-container{${surf('light')}}`)
  rules.push(`.tl-container.tl-theme__dark{${surf('dark')}}`)
  rules.push(`.tl-container .tl-background{background:var(--canvas)}`)
  for (const c of COLOR_TOKENS) {
    const l = COLORS[c].light
    const d = COLORS[c].dark
    rules.push(`.aifig-c-${c}{--c-bg:${l.bg};--c-ink:${l.ink};--c-accent:${l.accent}}`)
    rules.push(`.tl-theme__dark .aifig-c-${c}{--c-bg:${d.bg};--c-ink:${d.ink};--c-accent:${d.accent}}`)
  }
  const el = document.createElement('style')
  el.dataset.aifig = 'tokens'
  el.textContent = rules.join('\n')
  document.head.appendChild(el)
}
