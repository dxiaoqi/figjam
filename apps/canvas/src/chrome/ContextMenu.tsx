import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDownToLine,
  ArrowUpToLine,
  Clipboard,
  Copy,
  CopyPlus,
  Frame,
  Image,
  LayoutGrid,
  Maximize,
  MousePointerSquareDashed,
  PanelTop,
  Pencil,
  RotateCcw,
  Scissors,
  StickyNote,
  Trash2,
  Type,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { Vec } from '@aifig/canvas-engine'
import type { RouteStyle } from '@aifig/shared'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useBoard, useBoardTitle } from '../board-context'
import { useEditor } from '../canvas/editor-context'
import { callCore } from '../lib/core'
import { copySnapshot, downloadDocument, downloadSnapshot } from '../lib/export'

interface MenuState {
  screen: Vec
  page: Vec
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl+'

export function ContextMenu() {
  const editor = useEditor()
  const { boardId, theme } = useBoard()
  const title = useBoardTitle()
  const [menu, setMenu] = useState<MenuState | null>(null)

  useEffect(() => {
    editor.options.onContextMenu = ({ screen, page }) => setMenu({ screen, page })
    return () => {
      editor.options.onContextMenu = undefined
    }
  }, [editor])

  // ⇧⌘C copies the selection (or the board) as PNG; ⌘G groups into a frame
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        const ids = editor.selectedBlocks().map((b) => b.id)
        copySnapshot(boardId, { ids: ids.length ? ids : undefined, theme })
      } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        editor.groupIntoFrame()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editor, boardId, theme])

  if (!menu) return null
  const blocks = editor.selectedBlocks()
  const connectors = [...editor.selection].map((id) => editor.connector(id)).filter(Boolean)
  const ids = blocks.map((b) => b.id)
  const sameParent = blocks.length > 1 && blocks.every((b) => (b.parent ?? null) === (blocks[0].parent ?? null))
  const close = () => setMenu(null)
  const run = (fn: () => void) => () => {
    fn()
    close()
  }

  const copy = async (cut = false) => {
    const text = editor.copy()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* the internal clipboard still works for ⌘V inside the canvas */
    }
    if (cut) editor.deleteSelection()
  }
  const paste = async () => {
    let text: string | null = null
    try {
      text = await navigator.clipboard.readText()
    } catch {
      /* fall back to the internal clipboard */
    }
    editor.paste(text, menu.page)
  }
  const addHere = (tool: string) => editor.createWithTool(tool, menu.page)
  const tidy = async () => {
    try {
      await callCore('arrange', { board: boardId, ids, layout: 'grid' })
      toast.success('Tidied into a grid')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const route = connectors.length ? (connectors[0]!.route ?? 'curved') : 'curved'

  return (
    <DropdownMenu open onOpenChange={(o) => !o && close()} modal={false}>
      <DropdownMenuTrigger asChild>
        <span className="pointer-events-none fixed size-px" style={{ left: menu.screen.x, top: menu.screen.y }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" sideOffset={2} className="w-56" data-ui onCloseAutoFocus={(e) => e.preventDefault()}>
        {blocks.length > 0 && (
          <>
            {blocks.length === 1 && (
              <DropdownMenuItem onSelect={run(() => editor.startEditing(ids[0]))}>
                <Pencil /> Edit <DropdownMenuShortcut>↵</DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={run(() => copy(true))}>
              <Scissors /> Cut <DropdownMenuShortcut>{mod}X</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={run(() => copy())}>
              <Copy /> Copy <DropdownMenuShortcut>{mod}C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={run(paste)}>
              <Clipboard /> Paste <DropdownMenuShortcut>{mod}V</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={run(() => editor.duplicate())}>
              <CopyPlus /> Duplicate <DropdownMenuShortcut>{mod}D</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ArrowUpToLine /> Arrange
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52" data-ui>
                <DropdownMenuItem onSelect={run(() => editor.bringToFront())}>
                  <ArrowUpToLine /> Bring to front
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => editor.sendToBack())}>
                  <ArrowDownToLine /> Send to back
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={run(() => editor.groupIntoFrame())} disabled={blocks.every((b) => b.kind === 'frame')}>
                  <Frame /> Group into frame <DropdownMenuShortcut>{mod}G</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run(tidy)} disabled={!sameParent}>
                  <LayoutGrid /> Tidy into grid
                </DropdownMenuItem>
                {blocks.some((b) => b.rotation) && (
                  <DropdownMenuItem onSelect={run(() => editor.updateBlocks(blocks.filter((b) => b.rotation).map((b) => ({ id: b.id, patch: { rotation: 0 } }))))}>
                    <RotateCcw /> Reset rotation
                  </DropdownMenuItem>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={blocks.length < 2}>
                <AlignStartVertical /> Align &amp; distribute
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52" data-ui>
                <DropdownMenuItem onSelect={run(() => editor.align('left'))}>
                  <AlignStartVertical /> Align left
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => editor.align('center'))}>
                  <AlignCenterVertical /> Align center
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => editor.align('right'))}>
                  <AlignEndVertical /> Align right
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={run(() => editor.align('top'))}>
                  <AlignStartHorizontal /> Align top
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => editor.align('middle'))}>
                  <AlignCenterHorizontal /> Align middle
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => editor.align('bottom'))}>
                  <AlignEndHorizontal /> Align bottom
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={run(() => editor.distribute('x'))} disabled={blocks.length < 3}>
                  <AlignHorizontalDistributeCenter /> Distribute horizontally
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => editor.distribute('y'))} disabled={blocks.length < 3}>
                  <AlignVerticalDistributeCenter /> Distribute vertically
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Image /> Export selection
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52" data-ui>
                <DropdownMenuItem onSelect={run(() => copySnapshot(boardId, { ids, theme }))}>
                  Copy as PNG <DropdownMenuShortcut>⇧{mod}C</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => downloadSnapshot(boardId, title, 'png', { ids, theme }))}>Export PNG</DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => downloadSnapshot(boardId, title, 'svg', { ids, theme }))}>Export SVG</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={run(() => editor.deleteSelection())}>
              <Trash2 /> Delete <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        )}
        {!blocks.length && connectors.length > 0 && (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Connector</DropdownMenuLabel>
            {connectors.length === 1 && (
              <DropdownMenuItem onSelect={run(() => editor.startEditing(connectors[0]!.id))}>
                <Pencil /> Edit label <DropdownMenuShortcut>↵</DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Routing</DropdownMenuLabel>
            {connectors.some((c) => c!.waypoints?.length) && (
              <DropdownMenuItem onSelect={run(() => connectors.forEach((c) => c!.waypoints?.length && editor.setWaypoints(c!.id, [])))}>
                <RotateCcw /> Remove bends (auto-route)
              </DropdownMenuItem>
            )}
            <DropdownMenuRadioGroup value={route} onValueChange={(v) => (editor.setRoute(connectors.map((c) => c!.id), v as RouteStyle), close())}>
              <DropdownMenuRadioItem value="curved">Curved</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="elbow">Elbow</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="straight">Straight</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={run(() => editor.deleteSelection())}>
              <Trash2 /> Delete <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        )}
        {!blocks.length && !connectors.length && (
          <>
            <DropdownMenuItem onSelect={run(paste)}>
              <Clipboard /> Paste here <DropdownMenuShortcut>{mod}V</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={run(() => addHere('sticky'))}>
              <StickyNote /> Add sticky <DropdownMenuShortcut>S</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={run(() => addHere('card'))}>
              <PanelTop /> Add card <DropdownMenuShortcut>C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={run(() => addHere('text'))}>
              <Type /> Add heading <DropdownMenuShortcut>T</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={run(() => editor.selectAll())}>
              <MousePointerSquareDashed /> Select all <DropdownMenuShortcut>{mod}A</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={run(() => editor.zoomToFit())}>
              <Maximize /> Zoom to fit <DropdownMenuShortcut>⇧1</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Image /> Export board
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52" data-ui>
                <DropdownMenuItem onSelect={run(() => copySnapshot(boardId, { theme }))}>
                  Copy as PNG <DropdownMenuShortcut>⇧{mod}C</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => downloadSnapshot(boardId, title, 'png', { theme }))}>Export PNG</DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => downloadSnapshot(boardId, title, 'svg', { theme }))}>Export SVG</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={run(() => downloadDocument(boardId, 'md'))}>Export Markdown</DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => downloadDocument(boardId, 'json'))}>Export JSON</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
