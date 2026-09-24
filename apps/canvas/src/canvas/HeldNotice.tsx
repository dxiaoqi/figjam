import { useEditorVersion } from '@aifig/canvas-engine'
import { useEditor } from './editor-context'

/** A quiet note while agent moves near you are held back; they settle in once you pause. */
export function HeldNotice() {
  const editor = useEditor()
  useEditorVersion(editor)
  const n = editor.held.size
  if (!n) return null
  const who = [...editor.held.values()].find((h) => h.by?.kind === 'agent')?.by
  return (
    <div className="pointer-events-none absolute top-16 left-1/2 z-[170] -translate-x-1/2" data-held-notice>
      <div className="chrome flex items-center gap-2 rounded-full py-1 pr-3 pl-1.5 text-[12px] text-muted-foreground animate-in fade-in slide-in-from-top-1 duration-200">
        <span className="size-2 animate-pulse rounded-full" style={{ background: who?.color ?? 'var(--primary)' }} />
        <span>
          <span className="font-medium text-foreground">{who?.name ?? 'Layout'}</span> will move {n} block{n === 1 ? '' : 's'} near you once you pause
        </span>
      </div>
    </div>
  )
}
