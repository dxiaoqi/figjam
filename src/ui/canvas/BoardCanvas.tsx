import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { DefaultColorStyle, DefaultFontStyle, DefaultSizeStyle, FrameShapeUtil, Tldraw, createShapeId, react, type Editor, type TLComponents, type TLUiOverrides } from 'tldraw'
import type { Author } from '@/shared/model'
import { measureCard, measureSticky } from '@/shared/text'
import { SURFACES, snap } from '@/shared/tokens'
import { useBoard, useProviderState } from '../board-context'
import { BoardMenu } from '../chrome/BoardMenu'
import { EmptyState } from '../chrome/EmptyState'
import { ReviewPanel } from '../chrome/ReviewPanel'
import { StatusBanner } from '../chrome/StatusBanner'
import { StylePanel } from '../chrome/StylePanel'
import { Toolbar } from '../chrome/Toolbar'
import { TopRight } from '../chrome/TopRight'
import { AgentLayer } from './AgentLayer'
import { BoardBinding } from './binding'
import { Grid } from './Grid'
import { CARD, STICKY, TEXT, createStickyHere, customTools, nextColor, shapeUtils } from './shapes'

const QuietFrameShapeUtil = FrameShapeUtil.configure({
  getCustomDisplayValues(_editor, _shape, _theme, colorMode) {
    const s = SURFACES[colorMode]
    return { fillColor: s.frame, strokeColor: s.border, headingTextColor: s.muted }
  },
})
const allShapeUtils = [...shapeUtils, QuietFrameShapeUtil]

const ME: Author = { kind: 'human', id: 'human:ui', name: 'You' }
const KEEP_TOOLS = new Set(['select', 'hand', 'frame', 'arrow', 'laser', 'zoom'])

const overrides: TLUiOverrides = {
  tools(editor, tools) {
    for (const key of Object.keys(tools)) if (!KEEP_TOOLS.has(key)) delete tools[key]
    tools[STICKY] = { id: STICKY, icon: 'tool-note', label: 'Sticky note', kbd: 's', onSelect: () => editor.setCurrentTool(STICKY) }
    tools[CARD] = { id: CARD, icon: 'tool-frame', label: 'Card', kbd: 'c', onSelect: () => editor.setCurrentTool(CARD) }
    tools[TEXT] = { id: TEXT, icon: 'tool-text', label: 'Heading', kbd: 't', onSelect: () => editor.setCurrentTool(TEXT) }
    return tools
  },
}

const components: TLComponents = {
  Grid,
  MenuPanel: BoardMenu,
  SharePanel: TopRight,
  StylePanel,
  Toolbar,
  InFrontOfTheCanvas: AgentLayer,
  MainMenu: null,
  PageMenu: null,
  ActionsMenu: null,
  HelpMenu: null,
  DebugPanel: null,
  DebugMenu: null,
  QuickActions: null,
  HelperButtons: null,
  CursorChatBubble: null,
}

function setupEditor(editor: Editor) {
  editor.updateInstanceState({ isGridMode: true })
  editor.updateDocumentSettings({ gridSize: 8 })
  editor.setStyleForNextShapes(DefaultFontStyle, 'sans')
  editor.setStyleForNextShapes(DefaultSizeStyle, 's')
  editor.setStyleForNextShapes(DefaultColorStyle, 'grey')

  // double-click on empty canvas starts a sticky
  let lastDouble = 0
  editor.on('event', (info) => {
    if (info.name !== 'double_click' || info.type !== 'click' || info.target !== 'canvas') return
    if (Date.now() - lastDouble < 400 || !editor.isIn('select.idle')) return
    lastDouble = Date.now()
    createStickyHere(editor)
  })

  editor.registerExternalContentHandler('text', async ({ point, text }) => {
    const center = point ?? editor.getViewportPageBounds().center
    const clean = text.trim()
    if (!clean) return
    const id = createShapeId()
    if (clean.length > 120 || clean.includes('\n')) {
      const [first, ...rest] = clean.split('\n')
      const title = first.slice(0, 80)
      const body = rest.join('\n').trim() || (first.length > 80 ? first : '')
      const m = measureCard(title, body, 'm')
      editor.createShape({ id, type: CARD, x: snap(center.x - m.w / 2), y: snap(center.y - m.h / 2), props: { ...m, title, text: body, color: 'blue', size: 'm' } })
    } else {
      const m = measureSticky(clean, 'm')
      editor.createShape({ id, type: STICKY, x: snap(center.x - m.w / 2), y: snap(center.y - m.h / 2), props: { w: m.w, h: m.h, size: m.size, text: clean, color: nextColor.get() } })
    }
    editor.select(id)
  })
  editor.registerExternalContentHandler('url', async ({ point, url }) => {
    const center = point ?? editor.getViewportPageBounds().center
    const m = measureCard(url, '', 'm')
    editor.createShape({ type: CARD, x: snap(center.x - m.w / 2), y: snap(center.y - m.h / 2), props: { ...m, title: url, text: '', color: 'gray', size: 'm' } })
  })
  editor.registerExternalContentHandler('files', async () => {
    toast('Images and files aren’t supported on boards yet — paste text instead.')
  })
}

export function BoardCanvas() {
  const { provider, theme } = useBoard()
  const { synced } = useProviderState()
  const [editor, setEditor] = useState<Editor | null>(null)
  // changing the colorScheme prop remounts the editor, so only use it for the first render
  const initialTheme = useRef(theme).current

  useEffect(() => {
    editor?.user.updateUserPreferences({ colorScheme: theme })
  }, [editor, theme])

  useEffect(() => {
    if (!editor || !synced) return
    const binding = new BoardBinding(editor, provider.doc, ME)
    binding.start()
    const bounds = editor.getCurrentPageBounds()
    if (bounds) editor.zoomToBounds(bounds, { inset: 160, targetZoom: 1 })
    else editor.centerOnPoint({ x: 0, y: 0 })

    let last = 0
    let timer: number | null = null
    const stop = react('report viewport', () => {
      const b = editor.getViewportPageBounds()
      const send = () => {
        last = Date.now()
        provider.sendViewport({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) })
      }
      if (timer) clearTimeout(timer)
      if (Date.now() - last > 250) send()
      else timer = window.setTimeout(send, 250)
    })
    const onStatus = provider.subscribe(() => {
      if (provider.status === 'connected') {
        const b = editor.getViewportPageBounds()
        provider.sendViewport({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) })
      }
    })
    return () => {
      binding.dispose()
      stop()
      onStatus()
      if (timer) clearTimeout(timer)
    }
  }, [editor, synced, provider])

  return (
    <div className="fixed inset-0">
      <Tldraw
        licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}
        shapeUtils={allShapeUtils}
        tools={customTools}
        overrides={overrides}
        components={components}
        colorScheme={initialTheme}
        options={{ maxPages: 1, createTextOnCanvasDoubleClick: false }}
        onMount={(e) => {
          setupEditor(e)
          setEditor(e)
          if (import.meta.env.DEV) (window as any).editor = e
        }}
      >
        <EmptyState />
        <ReviewPanel />
        <StatusBanner />
      </Tldraw>
      {!synced && (
        <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Opening board…
          </div>
        </div>
      )}
    </div>
  )
}
