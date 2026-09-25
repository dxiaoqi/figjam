import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { CanvasView, Editor } from '@aifig/canvas-engine'
import { COLORS, SURFACES, type Author, type Block } from '@aifig/shared'
import { useBoard, useProviderState } from '../board-context'
import { BoardMenu } from '../chrome/BoardMenu'
import { ContextMenu } from '../chrome/ContextMenu'
import { AssistantSettings } from '../chrome/AssistantSettings'
import { EmptyState } from '../chrome/EmptyState'
import { ReviewPanel } from '../chrome/ReviewPanel'
import { StatusBanner } from '../chrome/StatusBanner'
import { StylePanel } from '../chrome/StylePanel'
import { Toolbar } from '../chrome/Toolbar'
import { TopRight } from '../chrome/TopRight'
import { ZoomControls } from '../chrome/ZoomControls'
import { AgentLayer } from './AgentLayer'
import { toggleCommentMode } from './comment-prefs'
import { CommentLayer } from './CommentLayer'
import { HeldNotice } from './HeldNotice'
import { ReviewGhosts } from './ReviewGhosts'
import { SnippetDialog } from '../chrome/SnippetDialog'
import { FieldsPopover, TypeFilterBar, TypePalette, useRelationSuggestions } from './types-ui'
import { EditorContext } from './editor-context'
import { desktop } from '../lib/desktop'
import { downloadDocument, downloadSnapshot } from '../lib/export'
import { draftForPastedText, draftForTool, importImages, nextColor, shapeDefs } from './shapes'
import { toast } from 'sonner'

const ME: Author = { kind: 'human', id: 'human:ui', name: 'You' }

/** Flat colors for the far-zoom canvas and minimap, from the same tokens as the blocks. */
function lodStyle(b: Block) {
  const mode = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  const s = SURFACES[mode]
  const c = COLORS[b.color] ?? COLORS.gray
  switch (b.kind) {
    case 'frame':
      return { fill: s.frame, stroke: s.border }
    case 'card':
      return { fill: s.surface, stroke: s.border, accent: c[mode].accent }
    case 'text':
      return { fill: 'rgba(0,0,0,0)', accent: s.muted }
    case 'image':
      return { fill: s.border, stroke: s.border }
    default:
      return { fill: c[mode].bg, accent: c[mode].accent }
  }
}

function createEditor(doc: Editor['doc']) {
  const editor: Editor = new Editor({
    doc,
    shapes: shapeDefs,
    author: ME,
    gridSize: 8,
    toolKeys: { s: 'sticky', c: 'card', t: 'text' },
    lodStyle,
    createForTool: (tool) => draftForTool(tool),
    createForConnectorDrop: (from) => {
      const d = draftForTool('sticky')!
      return from.kind === 'sticky' ? { ...d, color: from.color } : { ...d, color: nextColor.get() }
    },
    onDoubleClickCanvas: (at) => editor.createWithTool('sticky', at),
    onFiles: (files, at) => {
      importImages(editor, files, at).catch(() => toast.error('Couldn’t read that image — try PNG, JPEG, GIF or WebP.'))
    },
    onPasteText: (text, at) => {
      if (!text.trim()) return
      const id = editor.placeDraft(draftForPastedText(text), at)
      editor.select([id])
    },
  })
  return editor
}

export function BoardCanvas() {
  const { provider } = useBoard()
  const { synced } = useProviderState()
  const [editor, setEditor] = useState<Editor | null>(null)
  useRelationSuggestions(editor)

  useEffect(() => {
    if (!synced) return
    const e = createEditor(provider.doc)
    setEditor(e)
    if (import.meta.env.DEV) (window as any).editor = e
    return () => {
      e.dispose()
      setEditor(null)
    }
  }, [synced, provider])

  // first frame: fit content, then keep the core informed about what the person is looking at
  useEffect(() => {
    if (!editor) return
    const raf = requestAnimationFrame(() => editor.zoomToFit(false))
    let last = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const report = () => {
      const b = editor.viewportPageBounds()
      if (!editor.viewport.w) return
      last = Date.now()
      provider.sendViewport({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) })
    }
    const offCamera = editor.onCamera(() => {
      if (timer) clearTimeout(timer)
      if (Date.now() - last > 250) report()
      else timer = setTimeout(report, 250)
    })
    const offStatus = provider.subscribe(() => provider.status === 'connected' && report())
    window.addEventListener('focus', report)
    return () => {
      window.removeEventListener('focus', report)
      cancelAnimationFrame(raf)
      offCamera()
      offStatus()
      if (timer) clearTimeout(timer)
    }
  }, [editor, provider])

  // native menu actions from the desktop shell
  const { boardId, theme: themeMode } = useBoard()
  useEffect(() => {
    if (!editor || !desktop) return
    return desktop.onMenu((action, payload) => {
      const ids = editor.selectedBlocks().map((b) => b.id)
      switch (action) {
        case 'undo':
          return editor.undo()
        case 'redo':
          return editor.redo()
        case 'duplicate':
          return editor.duplicate()
        case 'select-all':
          return editor.selectAll()
        case 'zoom-in':
          return editor.zoomIn()
        case 'zoom-out':
          return editor.zoomOut()
        case 'zoom-100':
          return editor.resetZoom()
        case 'zoom-fit':
          return editor.zoomToFit()
        case 'toggle-comments':
          return toggleCommentMode()
        case 'toggle-minimap':
          return window.dispatchEvent(new Event('aifig:toggle-minimap'))
        case 'assistant-settings':
          return window.dispatchEvent(new Event('aifig:assistant-settings'))
        case 'export':
          if (payload === 'png' || payload === 'svg') return downloadSnapshot(boardId, document.title.replace(/ — ai-figma$/, ''), payload, { ids: ids.length ? ids : undefined, theme: themeMode })
          return downloadDocument(boardId, payload === 'json' ? 'json' : 'md')
      }
    })
  }, [editor, boardId, themeMode])

  return (
    <div className="fixed inset-0 overflow-hidden bg-[var(--canvas)]">
      {editor ? (
        <EditorContext.Provider value={editor}>
          <CanvasView editor={editor} className="aifig-canvas">
            <ReviewGhosts />
            <AgentLayer />
            <CommentLayer />
            <HeldNotice />
            <FieldsPopover />
            <TypePalette />
          </CanvasView>
          <EmptyState />
          <TypeFilterBar />
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[300] flex items-start justify-between">
            <BoardMenu />
            <div className="flex flex-col items-end">
              <TopRight />
              <StylePanel />
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[300] flex justify-center">
            <Toolbar />
          </div>
          <ZoomControls />
          <ReviewPanel />
          <ContextMenu />
          <AssistantSettings />
          <SnippetDialog />
          <StatusBanner />
        </EditorContext.Provider>
      ) : (
        <div className="absolute inset-0 z-[1000] flex items-center justify-center">
          <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Opening board…
          </div>
        </div>
      )}
    </div>
  )
}
