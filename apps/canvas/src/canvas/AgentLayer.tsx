import { useEffect, useRef, useState } from 'react'
import { useCamera, type Editor } from '@aifig/canvas-engine'
import type { AgentPresence, Point } from '@aifig/shared'
import { useAgentsOnBoard } from '../board-context'
import { useEditor } from './editor-context'

const CURSOR_VISIBLE_MS = 20_000
const FOCUS_VISIBLE_MS = 6_000

function CursorGlyph({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" style={{ filter: 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.25))' }}>
      <path d="M3 2.5 L18 9.5 L11 11.5 L8.2 18.5 Z" fill={color} stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

/** Agent cursors, status capsules and working-area highlights, drawn in screen space above the canvas. */
export function AgentLayer() {
  const editor = useEditor()
  const agents = useAgentsOnBoard()
  const cam = useCamera(editor)
  const screen = editor.viewport
  const positions = useRef(new Map<string, Point>())
  const [, setTick] = useState(0)
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    let raf = 0
    const loop = () => {
      let moving = false
      for (const a of agents) {
        if (!a.cursor) continue
        const cur = positions.current.get(a.id)
        if (!cur || reduced) {
          positions.current.set(a.id, { ...a.cursor })
          moving = true
          continue
        }
        const dx = a.cursor.x - cur.x
        const dy = a.cursor.y - cur.y
        if (Math.abs(dx) + Math.abs(dy) > 0.5) {
          positions.current.set(a.id, { x: cur.x + dx * 0.14, y: cur.y + dy * 0.14 })
          moving = true
        }
      }
      if (moving) setTick((t) => t + 1)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    const idle = setInterval(() => setTick((t) => t + 1), 1000)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(idle)
    }
  }, [agents, reduced])

  const now = Date.now()
  const zoom = cam.z

  return (
    <div className="pointer-events-none absolute inset-0 z-[150] overflow-hidden">
      {agents.map((a) => (
        <AgentPresenceView key={a.id} editor={editor} agent={a} now={now} zoom={zoom} pos={positions.current.get(a.id)} screenW={screen.w} screenH={screen.h} />
      ))}
    </div>
  )
}

function AgentPresenceView({ editor, agent, now, zoom, pos, screenW, screenH }: { editor: Editor; agent: AgentPresence; now: number; zoom: number; pos?: Point; screenW: number; screenH: number }) {
  const age = now - agent.lastActive
  const focusOpacity = age < FOCUS_VISIBLE_MS ? 1 : 0
  const cursorOpacity = age < CURSOR_VISIBLE_MS - 6000 ? 1 : age < CURSOR_VISIBLE_MS ? (CURSOR_VISIBLE_MS - age) / 6000 : 0
  const style = { ['--agent' as string]: agent.color }
  const focus = agent.focus
  const f = focus ? editor.pageToScreen({ x: focus.x, y: focus.y }) : null
  const p = pos ? editor.pageToScreen(pos) : null
  const inset = 16
  const offscreen = p && (p.x < 0 || p.y < 0 || p.x > screenW || p.y > screenH)
  return (
    <>
      {focus && f && (
        <div
          className="aifig-focus"
          style={{ ...style, left: f.x - 12, top: f.y - 12, width: focus.w * zoom + 24, height: focus.h * zoom + 24, opacity: focusOpacity }}
        />
      )}
      {p && cursorOpacity > 0 && !offscreen && (
        <div className="absolute top-0 left-0 transition-opacity duration-500" style={{ transform: `translate(${p.x}px, ${p.y}px)`, opacity: cursorOpacity }}>
          <CursorGlyph color={agent.color} />
          <div
            className="absolute top-[18px] left-[14px] flex max-w-[280px] items-center gap-1.5 rounded-full py-1 pr-2.5 pl-2 text-[11px] font-medium whitespace-nowrap text-white shadow-md"
            style={{ background: agent.color }}
          >
            <span>{agent.name}</span>
            {agent.status && age < 15_000 && <span className="truncate font-normal opacity-85">· {agent.status}</span>}
          </div>
        </div>
      )}
      {p && cursorOpacity > 0 && offscreen && (
        <div
          className="absolute flex items-center gap-1 rounded-full py-1 pr-2.5 pl-1.5 text-[11px] font-medium text-white shadow-md"
          style={{
            background: agent.color,
            left: Math.min(Math.max(p.x, inset), screenW - 150),
            top: Math.min(Math.max(p.y, inset + 48), screenH - 96),
            opacity: cursorOpacity,
          }}
        >
          <span style={{ display: 'inline-block', transform: `rotate(${Math.atan2(p.y - screenH / 2, p.x - screenW / 2)}rad)` }}>➜</span>
          {agent.name} is working off-screen
        </div>
      )}
    </>
  )
}
