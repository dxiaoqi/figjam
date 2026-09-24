import { Plug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useBlockCount, useProviderState } from '../board-context'
import { useEditorState } from '../canvas/editor-context'

const KEYS: [string, string][] = [
  ['S', 'Sticky'],
  ['C', 'Card'],
  ['T', 'Heading'],
  ['F', 'Frame'],
  ['A', 'Connect'],
]

export function EmptyState() {
  const editor = useEditorState()
  const count = useBlockCount()
  const { synced } = useProviderState()
  const busy = editor.tool !== 'select' || editor.editingId !== null
  if (!synced || count > 0 || busy) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-[200] flex items-center justify-center p-6">
      <div className="chrome pointer-events-auto w-[420px] max-w-full animate-in fade-in zoom-in-95 rounded-3xl p-7 duration-300">
        <div className="mb-5 flex gap-1.5">
          <div className="h-9 w-9 rotate-[-4deg] rounded-[4px] bg-[#FFF1B8] shadow-sm dark:bg-[#4A4128]" />
          <div className="h-9 w-9 rotate-[3deg] rounded-[4px] bg-[#E8DEFF] shadow-sm dark:bg-[#3A3150]" />
          <div className="h-9 w-9 rotate-[-2deg] rounded-[4px] bg-[#CDF1EC] shadow-sm dark:bg-[#264341]" />
        </div>
        <h2 className="text-lg font-semibold tracking-tight">A calm canvas for you and your agents</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Sketch ideas yourself, or let Claude Code or Cursor lay out research, options and plans here. Everything they add is tidy by default and
          waits for your review.
        </p>
        <div className="mt-5 flex flex-wrap gap-1.5">
          {KEYS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => editor.setTool({ S: 'sticky', C: 'card', T: 'text', F: 'frame', A: 'connector' }[k]!)}
              className="flex items-center gap-1.5 rounded-lg border bg-background/60 px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <kbd className="rounded bg-muted px-1.5 font-mono text-[10px] text-foreground">{k}</kbd>
              {label}
            </button>
          ))}
        </div>
        <div className="mt-6 flex items-center justify-between gap-3 border-t pt-5">
          <span className="text-xs text-muted-foreground">Double-click anywhere to start writing.</span>
          <Button size="sm" className="gap-1.5" onClick={() => window.dispatchEvent(new Event('aifig:connect'))}>
            <Plug className="size-3.5" /> Connect an agent
          </Button>
        </div>
      </div>
    </div>
  )
}
