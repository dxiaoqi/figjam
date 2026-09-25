/**
 * Design tokens — the only visual values blocks may use.
 * Shared by the core (layout, snapshots, lint), the canvas UI, and agents (via MCP).
 */

export const COLOR_TOKENS = [
  'yellow',
  'orange',
  'red',
  'pink',
  'purple',
  'blue',
  'teal',
  'green',
  'gray',
] as const
export type ColorToken = (typeof COLOR_TOKENS)[number]

export const SIZE_TOKENS = ['s', 'm', 'l', 'xl'] as const
export type SizeToken = (typeof SIZE_TOKENS)[number]

interface ColorPair {
  /** Block background */
  bg: string
  /** Text on bg */
  ink: string
  /** Accent (card bar, swatch, strokes) */
  accent: string
}

/** Soft, equal-lightness sticky colors. Dark variants are desaturated, never glowing. */
export const COLORS: Record<ColorToken, { light: ColorPair; dark: ColorPair; hex: string }> = {
  yellow: {
    hex: '#F5C84C',
    light: { bg: '#FFF1B8', ink: '#4A3A00', accent: '#E8B22E' },
    dark: { bg: '#4A4128', ink: '#F7EBC4', accent: '#D9AE45' },
  },
  orange: {
    hex: '#F29B5C',
    light: { bg: '#FFE0C7', ink: '#5A2D0C', accent: '#EE8A45' },
    dark: { bg: '#4D3627', ink: '#F8DCC8', accent: '#E08A50' },
  },
  red: {
    hex: '#EE7B7B',
    light: { bg: '#FFD9D6', ink: '#5E1A17', accent: '#E5625C' },
    dark: { bg: '#4D2E2D', ink: '#F8D5D2', accent: '#DB6A64' },
  },
  pink: {
    hex: '#EC8FC0',
    light: { bg: '#FCDDEE', ink: '#5A1840', accent: '#DE6FAA' },
    dark: { bg: '#4A2E3F', ink: '#F6D6E8', accent: '#D478A9' },
  },
  purple: {
    hex: '#A88BEB',
    light: { bg: '#E8DEFF', ink: '#34206B', accent: '#9577E0' },
    dark: { bg: '#3A3150', ink: '#E3DAFA', accent: '#9A83DB' },
  },
  blue: {
    hex: '#6FA8EE',
    light: { bg: '#D6E8FF', ink: '#10325E', accent: '#5596E6' },
    dark: { bg: '#2A3A4F', ink: '#D3E3F8', accent: '#6C9FDC' },
  },
  teal: {
    hex: '#5CC6BE',
    light: { bg: '#CDF1EC', ink: '#0B4540', accent: '#3FB3AA' },
    dark: { bg: '#264341', ink: '#CDEDE9', accent: '#52B2AA' },
  },
  green: {
    hex: '#86C77A',
    light: { bg: '#DDF3D2', ink: '#1E4614', accent: '#6BB85C' },
    dark: { bg: '#2F4229', ink: '#D8EDD0', accent: '#77B268' },
  },
  gray: {
    hex: '#A3A3A3',
    light: { bg: '#EDEDEB', ink: '#2B2B29', accent: '#9C9C98' },
    dark: { bg: '#34343A', ink: '#E4E4E7', accent: '#8E8E96' },
  },
}

/** Canvas content type scale (px). Headings only use l / xl. */
export const FONT_SIZES: Record<SizeToken, number> = { s: 14, m: 18, l: 24, xl: 36 }
export const LINE_HEIGHT = 1.45

export const SPACING = {
  grid: 8,
  blockPadding: 16,
  gap: 24,
  clusterGap: 64,
  framePadding: 32,
  frameHeader: 16,
} as const

export const STICKY_SIZES: Record<SizeToken, number> = { s: 160, m: 200, l: 240, xl: 240 }
export const CARD_WIDTHS: Record<SizeToken, number> = { s: 240, m: 280, l: 360, xl: 360 }
export const TEXT_MAX_WIDTH: Record<SizeToken, number> = { s: 360, m: 440, l: 560, xl: 720 }

export const RADII = { sticky: 4, card: 8, frame: 12 } as const

/** Neutral UI surfaces, per theme. */
export const SURFACES = {
  light: {
    canvas: '#FAFAF9',
    surface: '#FFFFFF',
    border: '#E7E5E4',
    ink: '#1C1917',
    muted: '#78716C',
    frame: '#F4F4F2',
    connector: '#A8A29E',
  },
  dark: {
    canvas: '#141416',
    surface: '#1E1E22',
    border: '#2E2E34',
    ink: '#F4F4F5',
    muted: '#A1A1AA',
    frame: '#1A1A1D',
    connector: '#6B6B73',
  },
} as const

/** Agent identity colors — deliberately separate from content colors. */
export const AGENT_COLORS = ['#D97757', '#6E56CF', '#0EA5E9', '#10A37F', '#E5484D', '#D6409F'] as const

export function snap(v: number, step: number = SPACING.grid) {
  return Math.round(v / step) * step
}

export function snapUp(v: number, step: number = SPACING.grid) {
  return Math.ceil(v / step) * step
}

const COLOR_ALIASES: Record<string, ColorToken> = {
  amber: 'yellow',
  gold: 'yellow',
  lemon: 'yellow',
  peach: 'orange',
  coral: 'orange',
  rose: 'pink',
  magenta: 'pink',
  crimson: 'red',
  violet: 'purple',
  indigo: 'purple',
  lavender: 'purple',
  sky: 'blue',
  navy: 'blue',
  cyan: 'teal',
  aqua: 'teal',
  mint: 'teal',
  lime: 'green',
  emerald: 'green',
  grey: 'gray',
  neutral: 'gray',
  white: 'gray',
  black: 'gray',
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.replace('#', '').match(/^([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** Quantize any color input (token, alias, or hex) to the nearest token. */
export function toColorToken(input: unknown, fallback: ColorToken = 'yellow'): ColorToken {
  if (typeof input !== 'string' || !input.trim()) return fallback
  const v = input.trim().toLowerCase()
  if ((COLOR_TOKENS as readonly string[]).includes(v)) return v as ColorToken
  if (COLOR_ALIASES[v]) return COLOR_ALIASES[v]
  const rgb = hexToRgb(v)
  if (!rgb) return fallback
  let best: ColorToken = fallback
  let bestD = Infinity
  for (const t of COLOR_TOKENS) {
    const c = hexToRgb(COLORS[t].hex)!
    const d = (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2
    if (d < bestD) {
      bestD = d
      best = t
    }
  }
  return best
}

export function toSizeToken(input: unknown, fallback: SizeToken = 'm'): SizeToken {
  if (typeof input !== 'string') return fallback
  const v = input.trim().toLowerCase()
  const map: Record<string, SizeToken> = { small: 's', medium: 'm', large: 'l', xlarge: 'xl', 'x-large': 'xl' }
  if ((SIZE_TOKENS as readonly string[]).includes(v)) return v as SizeToken
  return map[v] ?? fallback
}

/** Public token manifest for agents (aifig://design/tokens). */
export function tokenManifest() {
  return {
    colors: COLOR_TOKENS,
    sizes: SIZE_TOKENS,
    fontSizes: FONT_SIZES,
    spacing: SPACING,
    stickySizes: STICKY_SIZES,
    cardWidths: CARD_WIDTHS,
    notes: [
      'Only token names are accepted; hex values are quantized to the nearest token.',
      'Positions and sizes snap to an 8px grid. Prefer layout intents over coordinates.',
      'Use at most 4 colors per frame. Use color to encode meaning (e.g. green = strength, red = risk).',
    ],
  }
}
/** How a color input was understood: exact token, alias, nearest token to a hex value, or not at all. */
export function matchColor(input: unknown, fallback: ColorToken = 'yellow'): { token: ColorToken; how: 'token' | 'alias' | 'hex' | 'unknown' } {
  if (typeof input !== 'string' || !input.trim()) return { token: fallback, how: 'unknown' }
  const v = input.trim().toLowerCase()
  if ((COLOR_TOKENS as readonly string[]).includes(v)) return { token: v as ColorToken, how: 'token' }
  if (COLOR_ALIASES[v]) return { token: COLOR_ALIASES[v], how: 'alias' }
  if (hexToRgb(v)) return { token: toColorToken(v, fallback), how: 'hex' }
  return { token: fallback, how: 'unknown' }
}
