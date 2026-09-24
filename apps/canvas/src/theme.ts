import { COLORS, COLOR_TOKENS, SURFACES } from '@aifig/shared'

/** Turn the shared design tokens into CSS variables so the canvas and the core render identically. */
export function installTokenStyles() {
  const rules: string[] = []
  const surf = (t: 'light' | 'dark') =>
    `--surface:${SURFACES[t].surface};--ink:${SURFACES[t].ink};--border-c:${SURFACES[t].border};--muted-c:${SURFACES[t].muted};--canvas:${SURFACES[t].canvas};--frame-bg:${SURFACES[t].frame};--grid-dot:${t === 'light' ? 'rgb(28 25 23 / 0.13)' : 'rgb(255 255 255 / 0.08)'};`
  rules.push(`:root{${surf('light')}}`)
  rules.push(`.dark{${surf('dark')}}`)
  for (const c of COLOR_TOKENS) {
    const l = COLORS[c].light
    const d = COLORS[c].dark
    rules.push(`.aifig-c-${c}{--c-bg:${l.bg};--c-ink:${l.ink};--c-accent:${l.accent}}`)
    rules.push(`.dark .aifig-c-${c}{--c-bg:${d.bg};--c-ink:${d.ink};--c-accent:${d.accent}}`)
  }
  const el = document.createElement('style')
  el.dataset.aifig = 'tokens'
  el.textContent = rules.join('\n')
  document.head.appendChild(el)
}
