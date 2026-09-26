import { COLORS, SURFACES, type ColorToken, type TemplateId } from '@aifig/shared'
import type { ThemeMode } from '../board-context'

type Id = TemplateId | 'blank'

/** A miniature of each template, drawn from the same color tokens as the blocks. */
export function TemplatePreview({ id, theme, className }: { id: Id; theme: ThemeMode; className?: string }) {
  const s = SURFACES[theme]
  const frame = (x: number, y: number, w: number, h: number) => <rect key={`f${x},${y}`} x={x} y={y} width={w} height={h} rx={3} fill={s.frame} stroke={s.border} strokeWidth={0.6} />
  const sticky = (x: number, y: number, c: ColorToken, size = 12) => <rect key={`s${x},${y}`} x={x} y={y} width={size} height={size} rx={1} fill={COLORS[c][theme].bg} />
  const card = (x: number, y: number, w: number, h: number, c: ColorToken) => (
    <g key={`c${x},${y}`}>
      <rect x={x} y={y} width={w} height={h} rx={1.6} fill={s.surface} stroke={s.border} strokeWidth={0.5} />
      <rect x={x} y={y} width={w} height={1.6} rx={0.8} fill={COLORS[c][theme].accent} />
      <rect x={x + 3} y={y + 4.5} width={w * 0.55} height={1.8} rx={0.9} fill={s.muted} opacity={0.7} />
      <rect x={x + 3} y={y + 8} width={w * 0.7} height={1.4} rx={0.7} fill={s.muted} opacity={0.35} />
    </g>
  )
  const grid = (x: number, y: number, cols: number, rows: number, color: (c: number, r: number) => ColorToken, size = 12, gap = 4) =>
    Array.from({ length: cols * rows }, (_, i) => sticky(x + (i % cols) * (size + gap), y + Math.floor(i / cols) * (size + gap), color(i % cols, Math.floor(i / cols)), size))
  const heading = (x: number, y: number, w: number) => <rect key={`h${x},${y}`} x={x} y={y} width={w} height={2.4} rx={1.2} fill={s.muted} opacity={0.8} />

  let body: React.ReactNode
  switch (id) {
    case 'research-synthesis':
      body = [
        frame(6, 12, 40, 76),
        ...grid(10, 16, 2, 4, () => 'teal', 14, 3.5),
        frame(52, 12, 52, 52),
        heading(57, 17, 14),
        heading(79, 17, 14),
        ...grid(57, 23, 2, 2, () => 'purple', 18, 4),
        frame(110, 12, 44, 58),
        card(114, 16, 36, 14, 'orange'),
        card(114, 34, 36, 14, 'orange'),
        card(114, 52, 36, 14, 'blue'),
      ]
      break
    case 'competitor-analysis':
      body = [
        frame(6, 8, 148, 30),
        card(11, 13, 44, 20, 'purple'),
        card(58, 13, 44, 20, 'blue'),
        card(105, 13, 44, 20, 'teal'),
        frame(6, 44, 104, 50),
        heading(11, 48, 16),
        heading(45, 48, 16),
        heading(79, 48, 16),
        ...grid(11, 54, 3, 3, (c) => (['green', 'red', 'yellow'] as const)[c], 10, 3).map((el, i) => <g key={i} transform={`translate(${(i % 3) * 21} 0)`}>{el}</g>),
      ]
      break
    case 'user-journey':
      body = [
        frame(6, 8, 116, 62),
        ...[0, 1, 2, 3].map((i) => heading(11 + i * 28, 13, 14)),
        ...grid(11, 19, 4, 3, (_, r) => (['blue', 'yellow', 'red'] as const)[r], 14, 2.5).map((el, i) => <g key={i} transform={`translate(${(i % 4) * 11.5} 0)`}>{el}</g>),
        frame(6, 74, 84, 20),
        ...grid(11, 78, 4, 1, () => 'yellow', 12, 7),
        frame(128, 8, 26, 26),
        card(131, 12, 20, 18, 'gray'),
      ]
      break
    case 'brainstorm':
      body = [
        frame(6, 6, 52, 24),
        card(10, 10, 44, 16, 'blue'),
        frame(6, 36, 100, 58),
        heading(11, 41, 16),
        heading(44, 41, 16),
        heading(77, 41, 16),
        ...grid(11, 47, 3, 3, () => 'yellow', 12, 3).map((el, i) => <g key={i} transform={`translate(${(i % 3) * 18} 0)`}>{el}</g>),
        frame(112, 36, 42, 38),
        card(116, 40, 34, 14, 'green'),
        card(116, 57, 34, 14, 'green'),
      ]
      break
    case 'meeting-notes':
      body = [
        frame(6, 20, 32, 56),
        card(9, 24, 26, 14, 'gray'),
        card(9, 41, 26, 14, 'gray'),
        card(9, 58, 26, 14, 'gray'),
        frame(42, 20, 42, 42),
        ...grid(46, 24, 2, 2, (c, r) => (c === 0 && r === 1 ? 'blue' : 'yellow'), 15, 4),
        frame(88, 20, 26, 42),
        sticky(92, 24, 'purple', 18),
        sticky(92, 45, 'purple', 13),
        frame(118, 20, 36, 60),
        card(121, 24, 30, 15, 'green'),
        card(121, 42, 30, 15, 'green'),
        card(121, 60, 30, 15, 'green'),
      ]
      break
    default:
      body = (
        <g opacity={0.9}>
          {Array.from({ length: 9 * 5 }, (_, i) => (
            <circle key={i} cx={24 + (i % 9) * 14} cy={22 + Math.floor(i / 9) * 14} r={0.9} fill={s.muted} opacity={0.45} />
          ))}
          <rect x={66} y={40} width={24} height={24} rx={1.5} fill={COLORS.yellow[theme].bg} transform="rotate(-4 78 52)" />
        </g>
      )
  }
  return (
    <svg viewBox="0 0 160 100" className={className} aria-hidden>
      <rect width={160} height={100} fill={s.canvas} />
      {body}
    </svg>
  )
}
