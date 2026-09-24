import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { CanvasView, Editor } from '@aifig/canvas-engine'
import type { Author } from '@aifig/shared'
import { useBoard, useProviderState } from '../board-context'
import { BoardMenu } from '../chrome/BoardMenu'
import { EmptyState } from '../chrome/EmptyState'
import { ReviewPanel } from '../chrome/ReviewPanel'
import { StatusBanner } from '../chrome/StatusBanner'
import { StylePanel } from '../chrome/StylePanel'
import { Toolbar } from '../chrome/Toolbar'
import { TopRight } from '../chrome/TopRight'
import { ZoomControls } from '../chrome/ZoomControls'
import { AgentLayer } from './AgentLayer'
import { EditorContext } from './editor-context'
import { draftForPastedText, draftForTool, nextColor, shapeDefs } from './shapes'

const ME: Author = { kind: 'human', id: 'human:ui', name: 'You' }

function createEditor(doc: Editor['doc']) {
  const editor: Editor = new Editor({
    doc,
    shapes: shapeDefs,
    author: ME,
    gridSize: 8,
    toolKeys: { s: 'sticky', c: 'card', t: 'text' },
    createForTool: (tool) => draftForTool(tool),
    createForConnectorDrop: (from) => {
      const d = draftForTool('sticky')!
      return from.kind === 'sticky' ? { ...d, color: from.color } : { ...d, color: nextColor.get() }
    },
    onDoubleClickCanvas: (at) => editor.createWithTool('sticky', at),
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
    return () => {
      cancelAnimationFrame(raf)
      offCamera()
      offStatus()
      if (timer) clearTimeout(timer)
    }
  }, [editor, provider])

  return (
    <div className="fixed inset-0 overflow-hidden bg-[var(--canvas)]">
      {editor ? (
        <EditorContext.Provider value={editor}>
          <CanvasView editor={editor} className="aifig-canvas">
            <AgentLayer />
          </CanvasView>
          <EmptyState />
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
