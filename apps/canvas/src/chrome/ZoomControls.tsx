import { Maximize, Minus, Plus, Redo2, Undo2 } from 'lucide-react'
import { useCamera } from '@aifig/canvas-engine'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useEditorState } from '../canvas/editor-context'

function IconButton({ label, kbd, onClick, disabled, children }: { label: string; kbd?: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="flex items-center gap-2">
        {label}
        {kbd && <kbd className="rounded bg-background/20 px-1.5 font-mono text-[10px]">{kbd}</kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

export function ZoomControls() {
  const editor = useEditorState()
  const cam = useCamera(editor)
  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 z-[300] hidden items-center gap-1 sm:flex">
      <div className="chrome flex items-center rounded-xl p-1">
        <IconButton label="Undo" kbd="⌘Z" onClick={() => editor.undo()} disabled={!editor.undoManager.canUndo()}>
          <Undo2 className="size-4" strokeWidth={1.75} />
        </IconButton>
        <IconButton label="Redo" kbd="⇧⌘Z" onClick={() => editor.redo()} disabled={!editor.undoManager.canRedo()}>
          <Redo2 className="size-4" strokeWidth={1.75} />
        </IconButton>
      </div>
      <div className="chrome flex items-center rounded-xl p-1">
        <IconButton label="Zoom out" kbd="⌘−" onClick={() => editor.zoomOut()}>
          <Minus className="size-4" strokeWidth={1.75} />
        </IconButton>
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => editor.resetZoom()} className="h-8 w-12 rounded-lg text-xs font-medium tabular-nums text-muted-foreground hover:bg-accent hover:text-foreground">
              {Math.round(cam.z * 100)}%
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Reset to 100%</TooltipContent>
        </Tooltip>
        <IconButton label="Zoom in" kbd="⌘+" onClick={() => editor.zoomIn()}>
          <Plus className="size-4" strokeWidth={1.75} />
        </IconButton>
        <IconButton label="Zoom to fit" kbd="⇧1" onClick={() => editor.zoomToFit()}>
          <Maximize className="size-3.5" strokeWidth={1.75} />
        </IconButton>
      </div>
    </div>
  )
}
