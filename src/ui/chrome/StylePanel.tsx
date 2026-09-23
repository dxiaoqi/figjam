import { LayoutGrid, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useEditor, useValue, type TLShape } from 'tldraw'
import { cn } from '@/ui/lib/utils'
import { measureCard, measureText } from '@/shared/text'
import { COLORS, COLOR_TOKENS, STICKY_SIZES, type ColorToken, type SizeToken } from '@/shared/tokens'
import { useBoard } from '../board-context'
import { callCore } from '../lib/core'
import { CARD, STICKY, TEXT, isAifigShape, nextColor, type AifigShape } from '../canvas/shapes'

const bid = (id: string) => id.replace(/^shape:/, '')

function sizeProps(s: AifigShape, size: SizeToken) {
  if (s.type === STICKY) return { size, w: STICKY_SIZES[size], h: STICKY_SIZES[size] }
  if (s.type === CARD) return { size, ...measureCard(s.props.title, s.props.text, size) }
  return { size, ...measureText(s.props.text, size) }
}

export function StylePanel() {
  const editor = useEditor()
  const { boardId } = useBoard()
  const selected = useValue('selection', () => editor.getSelectedShapes(), [editor])
  const dark = useValue('dark', () => editor.getColorMode() === 'dark', [editor])
  const blocks = selected.filter(isAifigShape)
  const frames = selected.filter((s: TLShape) => s.type === 'frame')
  if (!blocks.length && !frames.length) return null

  const colored = blocks.filter((b) => b.type !== TEXT)
  const colors = new Set(colored.map((b) => b.props.color))
  const sizes = new Set(blocks.map((b) => b.props.size))
  const sizeOptions: SizeToken[] = blocks.every((b) => b.type === TEXT) ? ['s', 'm', 'l', 'xl'] : blocks.every((b) => b.type === CARD) ? ['m', 'l'] : ['s', 'm', 'l']
  const sameParent = blocks.length > 1 && blocks.every((b) => b.parentId === blocks[0].parentId)

  const setColor = (c: ColorToken) => {
    editor.markHistoryStoppingPoint('color')
    editor.updateShapes(colored.map((b) => ({ id: b.id, type: b.type, props: { color: c } })) as any)
    nextColor.set(c)
  }
  const setSize = (size: SizeToken) => {
    editor.markHistoryStoppingPoint('size')
    editor.updateShapes(blocks.map((b) => ({ id: b.id, type: b.type, props: sizeProps(b, size) })) as any)
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
            <button className="flex h-8 items-center gap-2 rounded-lg px-2 text-left hover:bg-accent" onClick={() => run('tidy', { frame: bid(frames[0].id) }, 'Frame tidied')}>
              <Sparkles className="size-3.5" /> Tidy frame
            </button>
          )}
          {sameParent && (
            <button
              className="flex h-8 items-center gap-2 rounded-lg px-2 text-left hover:bg-accent"
              onClick={() => run('arrange', { ids: blocks.map((b) => bid(b.id)), layout: 'grid' }, 'Arranged in a grid')}
            >
              <LayoutGrid className="size-3.5" /> Arrange in grid
            </button>
          )}
        </div>
      )}
    </div>
  )
}
