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
  Check,
  ArrowUpToLine,
  Clipboard,
  Code2,
  Copy,
  CopyPlus,
  ExternalLink,
  Frame,
  Image,
  LayoutGrid,
  Maximize,
  MousePointerSquareDashed,
  PanelTop,
  MessageSquarePlus,
  Pencil,
  Play,
  RotateCcw,
  Scissors,
  Sparkles,
  StickyNote,
  Tags,
  Trash2,
  Type,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { Vec } from '@aifig/canvas-engine'
import { BLOCK_TYPE_IDS, BLOCK_TYPES, COLORS, RELATIONS, type Relation, type RouteStyle } from '@aifig/shared'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
import { autoType, isTypeable, setBlocksType, TYPE_ICONS, useAutoType } from '../canvas/types-ui'
import { callCore } from '../lib/core'
import { copySnapshot, downloadDocument, downloadSnapshot } from '../lib/export'
import { runAssistant, useAssistant } from '../lib/assistant'

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
  const assistant = useAssistant()
  const autoTypeOn = useAutoType()

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
            {blocks.length === 1 && blocks[0].kind === 'web' && (
              <>
                <DropdownMenuItem onSelect={run(() => editor.startEditing(ids[0]))} data-web-run>
                  <Play /> {blocks[0].web?.mode === 'url' ? 'Open here' : 'Run'}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => window.dispatchEvent(new CustomEvent('aifig:snippet-dialog', { detail: { id: ids[0] } })))} data-web-edit>
                  <Code2 /> {blocks[0].web?.mode === 'url' ? 'Change URL…' : 'Edit source…'}
                </DropdownMenuItem>
                {blocks[0].web?.mode === 'url' && blocks[0].web.url && (
                  <DropdownMenuItem onSelect={run(() => window.open(blocks[0].web!.url, '_blank', 'noopener,noreferrer'))}>
                    <ExternalLink /> Open in browser
                  </DropdownMenuItem>
                )}
              </>
            )}
            {blocks.length === 1 && blocks[0].kind !== 'web' && (
              <DropdownMenuItem onSelect={run(() => editor.startEditing(ids[0]))}>
                <Pencil /> Edit <DropdownMenuShortcut>↵</DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
            {blocks.length === 1 && (
              <DropdownMenuItem onSelect={run(() => window.dispatchEvent(new CustomEvent('aifig:comment', { detail: ids[0] })))}>
                <MessageSquarePlus /> Comment <DropdownMenuShortcut>M</DropdownMenuShortcut>
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
            {blocks.some(isTypeable) && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger data-set-as>
                  <Tags /> Set as…
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56" data-ui>
                  {BLOCK_TYPE_IDS.map((t) => {
                    const Icon = TYPE_ICONS[t]
                    const all = blocks.filter(isTypeable).every((b) => b.type === t)
                    return (
                      <DropdownMenuItem key={t} data-set-type={t} onSelect={run(() => setBlocksType(editor, ids, t))}>
                        <Icon style={{ color: COLORS[BLOCK_TYPES[t].color].light.accent }} /> {BLOCK_TYPES[t].label}
                        {all ? <Check className="ml-auto size-3.5" /> : <DropdownMenuShortcut>{BLOCK_TYPES[t].prefixes[0]}</DropdownMenuShortcut>}
                      </DropdownMenuItem>
                    )
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem data-set-type="none" disabled={!blocks.some((b) => b.type)} onSelect={run(() => setBlocksType(editor, ids, null))}>
                    <Tags className="opacity-40" /> Plain (keeps fields hidden)
                  </DropdownMenuItem>
                  <DropdownMenuCheckboxItem checked={autoTypeOn} onCheckedChange={(v) => autoType.set(!!v)} onSelect={(e) => e.preventDefault()} data-auto-type>
                    Detect from prefix (?, !, “…)
                  </DropdownMenuCheckboxItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {assistant.available && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Assistant</DropdownMenuLabel>
                <DropdownMenuItem onSelect={run(() => runAssistant(boardId, 'extract', ids))}>
                  <Sparkles /> Extract ideas
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => runAssistant(boardId, 'cluster', ids))} disabled={blocks.filter((b) => b.kind !== 'frame').length < 3}>
                  <Sparkles /> Cluster into themes
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => runAssistant(boardId, 'tidy', ids))}>
                  <Sparkles /> Tidy up
                </DropdownMenuItem>
              </>
            )}
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
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-relation-menu>
                <Tags /> Relation{connectors.length === 1 && connectors[0]!.relation ? ` · ${connectors[0]!.relation}` : ''}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44" data-ui>
                <DropdownMenuRadioGroup
                  value={connectors.length === 1 ? (connectors[0]!.relation ?? 'none') : ''}
                  onValueChange={(v) => {
                    editor.doc.transact(() => {
                      for (const c of connectors) editor.connectorsMap.set(c!.id, { ...c!, relation: v === 'none' ? undefined : (v as Relation) })
                    }, editor.origin)
                    close()
                  }}
                >
                  {RELATIONS.map((r) => (
                    <DropdownMenuRadioItem key={r} value={r} data-relation={r}>
                      {r}
                    </DropdownMenuRadioItem>
                  ))}
                  <DropdownMenuRadioItem value="none">none</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
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
