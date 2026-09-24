import { LayoutGrid, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { COLORS, COLOR_TOKENS, STICKY_SIZES, measureText, type Block, type ColorToken, type SizeToken } from '@aifig/shared'
import { useBoard } from '../board-context'
import { useEditorState } from '../canvas/editor-context'
import { callCore } from '../lib/core'
import { cardHeight, nextColor } from '../canvas/shapes'

const CARD_W: Record<SizeToken, number> = { s: 240, m: 280, l: 360, xl: 360 }

function sizePatch(b: Block, size: SizeToken): Partial<Block> {
  if (b.kind === 'sticky') return { size, w: STICKY_SIZES[size], h: STICKY_SIZES[size] }
  if (b.kind === 'card') return { size, w: CARD_W[size], h: cardHeight(b.title ?? '', b.text, CARD_W[size]) }
  return { size, ...measureText(b.text, size) }
}

export function StylePanel() {
  const editor = useEditorState()
  const { boardId, theme } = useBoard()
  const dark = theme === 'dark'
  const selected = editor.selectedBlocks()
  const blocks = selected.filter((b) => b.kind !== 'frame' && b.kind !== 'image' && b.kind !== 'web')
  const frames = selected.filter((b) => b.kind === 'frame')
  if (editor.interaction.type !== 'idle' && editor.interaction.type !== 'pending') return null
  if (!blocks.length && !frames.length && !(selected.length > 1)) return null

  const colored = blocks.filter((b) => b.kind !== 'text')
  const colors = new Set(colored.map((b) => b.color))
  const sizes = new Set(blocks.map((b) => b.size))
  const sizeOptions: SizeToken[] = blocks.every((b) => b.kind === 'text') ? ['s', 'm', 'l', 'xl'] : blocks.every((b) => b.kind === 'card') ? ['m', 'l'] : ['s', 'm', 'l']
  const sameParent = blocks.length > 1 && blocks.every((b) => (b.parent ?? null) === (blocks[0].parent ?? null))

  const setColor = (c: ColorToken) => {
    editor.updateBlocks(colored.map((b) => ({ id: b.id, patch: { color: c } })))
    nextColor.set(c)
  }
  const setSize = (size: SizeToken) => {
    editor.updateBlocks(blocks.map((b) => ({ id: b.id, patch: sizePatch(b, size) })))
  }
  const run = async (tool: 'tidy' | 'arrange', args: Record<string, unknown>, done: string) => {
    try {
      await callCore(tool, { board: boardId, ...args })
      toast.success(done)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="pointer-events-auto mr-3 flex w-[212px] flex-col gap-3 rounded-2xl chrome p-3 text-xs">
      {colored.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-medium text-muted-foreground">Color</div>
          <div className="grid grid-cols-9 gap-1">
            {COLOR_TOKENS.map((c) => (
              <button
                key={c}
                aria-label={c}
                title={c}
                onClick={() => setColor(c)}
                className={cn('aspect-square rounded-full border border-black/5 transition-transform hover:scale-110', colors.size === 1 && colors.has(c) && 'ring-2 ring-foreground/70 ring-offset-1 ring-offset-background')}
                style={{ background: COLORS[c][dark ? 'dark' : 'light'].bg }}
              />
            ))}
          </div>
        </div>
      )}
      {blocks.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-medium text-muted-foreground">Size</div>
          <div className="flex gap-1 rounded-lg bg-muted p-0.5">
            {sizeOptions.map((s) => (
              <button
                key={s}
                onClick={() => setSize(s)}
                className={cn('h-7 flex-1 rounded-md font-medium uppercase transition-colors', sizes.size === 1 && sizes.has(s) ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      {(frames.length === 1 || sameParent) && (
        <div className="flex flex-col gap-1 border-t pt-2">
          {frames.length === 1 && (
            <button className="flex h-8 items-center gap-2 rounded-lg px-2 text-left hover:bg-accent" onClick={() => run('tidy', { frame: frames[0].id }, 'Frame tidied')}>
              <Sparkles className="size-3.5" /> Tidy frame
            </button>
          )}
          {sameParent && (
            <button
              className="flex h-8 items-center gap-2 rounded-lg px-2 text-left hover:bg-accent"
              onClick={() => run('arrange', { ids: blocks.map((b) => b.id), layout: 'grid' }, 'Arranged in a grid')}
            >
              <LayoutGrid className="size-3.5" /> Arrange in grid
            </button>
          )}
        </div>
      )}
    </div>
  )
}
