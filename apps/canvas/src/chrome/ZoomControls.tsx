import { Map as MapIcon, Maximize, Minus, Plus, Redo2, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Minimap, useCamera } from '@aifig/canvas-engine'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useEditorState } from '../canvas/editor-context'
import { useT } from '../i18n'

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
  const t = useT()
  const [showMap, setShowMap] = useState(() => localStorage.getItem('aifig:minimap') !== 'off')
  const toggleMap = () => {
    localStorage.setItem('aifig:minimap', showMap ? 'off' : 'on')
    setShowMap(!showMap)
  }
  useEffect(() => {
    const on = () => setShowMap((v) => {
      localStorage.setItem('aifig:minimap', v ? 'off' : 'on')
      return !v
    })
    window.addEventListener('aifig:toggle-minimap', on)
    return () => window.removeEventListener('aifig:toggle-minimap', on)
  }, [])
  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 z-[300] hidden flex-col items-start gap-2 sm:flex">
      {showMap && (
        <div className="chrome aifig-canvas rounded-xl p-1" style={{ backgroundImage: 'none' }}>
          <Minimap editor={editor} width={208} height={136} />
        </div>
      )}
      <div className="flex items-center gap-1">
      <div className="chrome flex items-center rounded-xl p-1">
        <IconButton label={t('zoom.undo')} kbd="⌘Z" onClick={() => editor.undo()} disabled={!editor.undoManager.canUndo()}>
          <Undo2 className="size-4" strokeWidth={1.75} />
        </IconButton>
        <IconButton label={t('zoom.redo')} kbd="⇧⌘Z" onClick={() => editor.redo()} disabled={!editor.undoManager.canRedo()}>
          <Redo2 className="size-4" strokeWidth={1.75} />
        </IconButton>
      </div>
      <div className="chrome flex items-center rounded-xl p-1">
        <IconButton label={t('zoom.out')} kbd="⌘−" onClick={() => editor.zoomOut()}>
          <Minus className="size-4" strokeWidth={1.75} />
        </IconButton>
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => editor.resetZoom()} className="h-8 w-12 rounded-lg text-xs font-medium tabular-nums text-muted-foreground hover:bg-accent hover:text-foreground">
              {Math.round(cam.z * 100)}%
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{t('zoom.reset')}</TooltipContent>
        </Tooltip>
        <IconButton label={t('zoom.in')} kbd="⌘+" onClick={() => editor.zoomIn()}>
          <Plus className="size-4" strokeWidth={1.75} />
        </IconButton>
        <IconButton label={t('zoom.fit')} kbd="⇧1" onClick={() => editor.zoomToFit()}>
          <Maximize className="size-3.5" strokeWidth={1.75} />
        </IconButton>
        <div className="mx-0.5 h-5 w-px bg-border" />
        <IconButton label={t(showMap ? 'zoom.hideMap' : 'zoom.showMap')} onClick={toggleMap}>
          <MapIcon className={cn('size-4', showMap && 'text-foreground')} strokeWidth={1.75} />
        </IconButton>
      </div>
      </div>
    </div>
  )
}
