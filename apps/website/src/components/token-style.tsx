import { AGENT_COLORS, COLORS, COLOR_TOKENS, SURFACES } from '@aifig/shared'

/** Emits the product's design tokens as CSS variables, so the site and the canvas share one source of truth. */
export function TokenStyle() {
  const vars: string[] = []
  for (const t of COLOR_TOKENS) {
    const { light } = COLORS[t]
    vars.push(`--tk-${t}-bg:${light.bg}`, `--tk-${t}-ink:${light.ink}`, `--tk-${t}-accent:${light.accent}`)
  }
  vars.push(
    `--tk-canvas:${SURFACES.light.canvas}`,
    `--tk-surface:${SURFACES.light.surface}`,
    `--tk-frame:${SURFACES.light.frame}`,
    `--tk-ink:${SURFACES.light.ink}`,
    `--tk-connector:${SURFACES.light.connector}`,
    `--tk-canvas-dark:${SURFACES.dark.canvas}`,
    `--tk-surface-dark:${SURFACES.dark.surface}`,
    `--tk-focus:#5b5bd6`,
  )
  AGENT_COLORS.forEach((c, i) => vars.push(`--tk-agent-${i}:${c}`))
  return <style>{`:root{${vars.join(';')}}`}</style>
}
