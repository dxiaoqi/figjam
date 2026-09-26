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
import { useT } from '../i18n'

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
  const t = useT()

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
      toast.success(t('menu.tidiedGrid'))
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
                  <Play /> {t(blocks[0].web?.mode === 'url' ? 'menu.openHere' : 'menu.run')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => window.dispatchEvent(new CustomEvent('aifig:snippet-dialog', { detail: { id: ids[0] } })))} data-web-edit>
                  <Code2 /> {t(blocks[0].web?.mode === 'url' ? 'menu.changeUrl' : 'menu.editSource')}
                </DropdownMenuItem>
                {blocks[0].web?.mode === 'url' && blocks[0].web.url && (
                  <DropdownMenuItem onSelect={run(() => window.open(blocks[0].web!.url, '_blank', 'noopener,noreferrer'))}>
                    <ExternalLink /> {t('menu.openBrowser')}
                  </DropdownMenuItem>
                )}
              </>
            )}
            {blocks.length === 1 && blocks[0].kind !== 'web' && (
              <DropdownMenuItem onSelect={run(() => editor.startEditing(ids[0]))}>
                <Pencil /> {t('menu.edit')} <DropdownMenuShortcut>↵</DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
            {blocks.length === 1 && (
              <DropdownMenuItem onSelect={run(() => window.dispatchEvent(new CustomEvent('aifig:comment', { detail: ids[0] })))}>
                <MessageSquarePlus /> {t('menu.comment')} <DropdownMenuShortcut>M</DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={run(() => copy(true))}>
              <Scissors /> {t('menu.cut')} <DropdownMenuShortcut>{mod}X</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={run(() => copy())}>
              <Copy /> {t('menu.copy')} <DropdownMenuShortcut>{mod}C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={run(paste)}>
              <Clipboard /> {t('menu.paste')} <DropdownMenuShortcut>{mod}V</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={run(() => editor.duplicate())}>
              <CopyPlus /> {t('menu.duplicate')} <DropdownMenuShortcut>{mod}D</DropdownMenuShortcut>
            </DropdownMenuItem>
            {blocks.some(isTypeable) && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger data-set-as>
                  <Tags /> {t('menu.setAs')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56" data-ui>
                  {BLOCK_TYPE_IDS.map((ty) => {
                    const Icon = TYPE_ICONS[ty]
                    const all = blocks.filter(isTypeable).every((b) => b.type === ty)
                    return (
                      <DropdownMenuItem key={ty} data-set-type={ty} onSelect={run(() => setBlocksType(editor, ids, ty))}>
                        <Icon style={{ color: COLORS[BLOCK_TYPES[ty].color].light.accent }} /> {t(`type.${ty}.label`)}
                        {all ? <Check className="ml-auto size-3.5" /> : <DropdownMenuShortcut>{BLOCK_TYPES[ty].prefixes[0]}</DropdownMenuShortcut>}
                      </DropdownMenuItem>
                    )
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem data-set-type="none" disabled={!blocks.some((b) => b.type)} onSelect={run(() => setBlocksType(editor, ids, null))}>
                    <Tags className="opacity-40" /> {t('menu.plainKeep')}
                  </DropdownMenuItem>
                  <DropdownMenuCheckboxItem checked={autoTypeOn} onCheckedChange={(v) => autoType.set(!!v)} onSelect={(e) => e.preventDefault()} data-auto-type>
                    {t('menu.detectPrefix')}
                  </DropdownMenuCheckboxItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {assistant.available && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t('menu.assistant')}</DropdownMenuLabel>
                <DropdownMenuItem onSelect={run(() => runAssistant(boardId, 'extract', ids))}>
                  <Sparkles /> {t('menu.extract')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => runAssistant(boardId, 'cluster', ids))} disabled={blocks.filter((b) => b.kind !== 'frame').length < 3}>
                  <Sparkles /> {t('menu.cluster')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => runAssistant(boardId, 'tidy', ids))}>
                  <Sparkles /> {t('menu.tidyUp')}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ArrowUpToLine /> {t('menu.arrange')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52" data-ui>
                <DropdownMenuItem onSelect={run(() => editor.bringToFront())}>
                  <ArrowUpToLine /> {t('menu.front')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => editor.sendToBack())}>
                  <ArrowDownToLine /> {t('menu.back')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={run(() => editor.groupIntoFrame())} disabled={blocks.every((b) => b.kind === 'frame')}>
                  <Frame /> {t('menu.group')} <DropdownMenuShortcut>{mod}G</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run(tidy)} disabled={!sameParent}>
                  <LayoutGrid /> {t('menu.tidyGrid')}
                </DropdownMenuItem>
                {blocks.some((b) => b.rotation) && (
                  <DropdownMenuItem onSelect={run(() => editor.updateBlocks(blocks.filter((b) => b.rotation).map((b) => ({ id: b.id, patch: { rotation: 0 } }))))}>
                    <RotateCcw /> {t('menu.resetRotation')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={blocks.length < 2}>
                <AlignStartVertical /> {t('menu.align')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52" data-ui>
                <DropdownMenuItem onSelect={run(() => editor.align('left'))}>
                  <AlignStartVertical /> {t('menu.alignLeft')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => editor.align('center'))}>
                  <AlignCenterVertical /> {t('menu.alignCenter')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => editor.align('right'))}>
                  <AlignEndVertical /> {t('menu.alignRight')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={run(() => editor.align('top'))}>
                  <AlignStartHorizontal /> {t('menu.alignTop')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => editor.align('middle'))}>
                  <AlignCenterHorizontal /> {t('menu.alignMiddle')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => editor.align('bottom'))}>
                  <AlignEndHorizontal /> {t('menu.alignBottom')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={run(() => editor.distribute('x'))} disabled={blocks.length < 3}>
                  <AlignHorizontalDistributeCenter /> {t('menu.distributeH')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => editor.distribute('y'))} disabled={blocks.length < 3}>
                  <AlignVerticalDistributeCenter /> {t('menu.distributeV')}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Image /> {t('menu.exportSelection')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52" data-ui>
                <DropdownMenuItem onSelect={run(() => copySnapshot(boardId, { ids, theme }))}>
                  {t('menu.copyPng')} <DropdownMenuShortcut>⇧{mod}C</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => downloadSnapshot(boardId, title, 'png', { ids, theme }))}>{t('menu.exportPng')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => downloadSnapshot(boardId, title, 'svg', { ids, theme }))}>{t('menu.exportSvg')}</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={run(() => editor.deleteSelection())}>
              <Trash2 /> {t('menu.delete')} <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        )}
        {!blocks.length && connectors.length > 0 && (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t('menu.connector')}</DropdownMenuLabel>
            {connectors.length === 1 && (
              <DropdownMenuItem onSelect={run(() => editor.startEditing(connectors[0]!.id))}>
                <Pencil /> {t('menu.editLabel')} <DropdownMenuShortcut>↵</DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t('menu.routing')}</DropdownMenuLabel>
            {connectors.some((c) => c!.waypoints?.length) && (
              <DropdownMenuItem onSelect={run(() => connectors.forEach((c) => c!.waypoints?.length && editor.setWaypoints(c!.id, [])))}>
                <RotateCcw /> {t('menu.removeBends')}
              </DropdownMenuItem>
            )}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-relation-menu>
                <Tags /> {t('menu.relation')}{connectors.length === 1 && connectors[0]!.relation ? ` · ${t(`relation.${connectors[0]!.relation}`)}` : ''}
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
                      {t(`relation.${r}`)}
                    </DropdownMenuRadioItem>
                  ))}
                  <DropdownMenuRadioItem value="none">{t('relation.none')}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuRadioGroup value={route} onValueChange={(v) => (editor.setRoute(connectors.map((c) => c!.id), v as RouteStyle), close())}>
              <DropdownMenuRadioItem value="curved">{t('menu.curved')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="elbow">{t('menu.elbow')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="straight">{t('menu.straight')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={run(() => editor.deleteSelection())}>
              <Trash2 /> {t('menu.delete')} <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        )}
        {!blocks.length && !connectors.length && (
          <>
            <DropdownMenuItem onSelect={run(paste)}>
              <Clipboard /> {t('menu.pasteHere')} <DropdownMenuShortcut>{mod}V</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={run(() => addHere('sticky'))}>
              <StickyNote /> {t('menu.addSticky')} <DropdownMenuShortcut>S</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={run(() => addHere('card'))}>
              <PanelTop /> {t('menu.addCard')} <DropdownMenuShortcut>C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={run(() => addHere('text'))}>
              <Type /> {t('menu.addHeading')} <DropdownMenuShortcut>T</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={run(() => editor.selectAll())}>
              <MousePointerSquareDashed /> {t('menu.selectAll')} <DropdownMenuShortcut>{mod}A</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={run(() => editor.zoomToFit())}>
              <Maximize /> {t('zoom.fit')} <DropdownMenuShortcut>⇧1</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Image /> {t('menu.exportBoard')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52" data-ui>
                <DropdownMenuItem onSelect={run(() => copySnapshot(boardId, { theme }))}>
                  {t('menu.copyPng')} <DropdownMenuShortcut>⇧{mod}C</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => downloadSnapshot(boardId, title, 'png', { theme }))}>{t('menu.exportPng')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => downloadSnapshot(boardId, title, 'svg', { theme }))}>{t('menu.exportSvg')}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={run(() => downloadDocument(boardId, 'md'))}>{t('menu.exportMd')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={run(() => downloadDocument(boardId, 'json'))}>{t('menu.exportJson')}</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
