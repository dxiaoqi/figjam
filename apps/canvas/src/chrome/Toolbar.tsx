import { Frame, Globe, Hand, ImagePlus, MessageCircle, MousePointer2, PanelTop, Spline, StickyNote, Type, type LucideIcon } from 'lucide-react'
import { useRef } from 'react'
import { toast } from 'sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { COLOR_TOKENS, COLORS } from '@aifig/shared'
import { useBoard } from '../board-context'
import { useEditorState } from '../canvas/editor-context'
import { toggleCommentMode, useCommentPrefs } from '../canvas/comment-prefs'
import { importFiles, nextColor, useNextColor } from '../canvas/shapes'
import { useT, type MessageKey } from '../i18n'

const TOOLS: { id: string; label: MessageKey; kbd: string; icon: LucideIcon }[] = [
  { id: 'select', label: 'tool.select', kbd: 'V', icon: MousePointer2 },
  { id: 'hand', label: 'tool.hand', kbd: 'H', icon: Hand },
  { id: 'sticky', label: 'tool.sticky', kbd: 'S', icon: StickyNote },
  { id: 'card', label: 'tool.card', kbd: 'C', icon: PanelTop },
  { id: 'text', label: 'tool.text', kbd: 'T', icon: Type },
  { id: 'frame', label: 'tool.frame', kbd: 'F', icon: Frame },
  { id: 'connector', label: 'tool.connector', kbd: 'A', icon: Spline },
]

export function Toolbar() {
  const editor = useEditorState()
  const { theme, boardId } = useBoard()
  const color = useNextColor()
  const current = editor.tool
  const showColors = current === 'sticky' || current === 'card'
  const fileRef = useRef<HTMLInputElement>(null)
  const { mode: commentMode } = useCommentPrefs()
  const t = useT()
  const onPick = async (files: FileList | null) => {
    const list = [...(files ?? [])]
    if (!list.length) return
    const vp = editor.viewportPageBounds()
    try {
      await importFiles(editor, boardId, list, { x: vp.x + vp.w / 2 - 240, y: vp.y + vp.h / 2 })
    } catch {
      toast.error(t('tool.imageError'))
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="pointer-events-auto mb-3 flex flex-col items-center gap-2">
      <div
        className={cn(
          'chrome flex items-center gap-1 rounded-full px-2 py-1.5 transition-all duration-200',
          showColors ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
        )}
      >
        {COLOR_TOKENS.map((c) => (
          <button
            key={c}
            aria-label={t(`color.${c}`)}
            onClick={() => nextColor.set(c)}
            className={cn('size-5 rounded-full border border-black/5 transition-transform hover:scale-110', color === c && 'ring-2 ring-foreground/70 ring-offset-2 ring-offset-background')}
            style={{ background: COLORS[c][theme].bg }}
          />
        ))}
      </div>
      <div className="chrome flex items-center gap-0.5 rounded-2xl p-1.5">
        {TOOLS.map((tool, i) => (
          <div key={tool.id} className="flex items-center">
            {(i === 2 || i === 5) && <div className="mx-1 h-6 w-px bg-border" />}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label={t(tool.label)}
                  onClick={() => editor.setTool(tool.id)}
                  className={cn(
                    'flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                    current === tool.id && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
                  )}
                >
                  <tool.icon className="size-[18px]" strokeWidth={1.75} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="flex items-center gap-2">
                {t(tool.label)}
                <kbd className="rounded bg-background/20 px-1.5 font-mono text-[10px]">{tool.kbd}</kbd>
              </TooltipContent>
            </Tooltip>
          </div>
        ))}
        <div className="mx-1 h-6 w-px bg-border" />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label={t('tool.image')}
              onClick={() => fileRef.current?.click()}
              className="flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ImagePlus className="size-[18px]" strokeWidth={1.75} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{t('tool.imageHintVideo')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label={t('tool.comments')}
              aria-pressed={commentMode}
              data-comment-ui
              data-comment-toggle
              onClick={() => {
                if (!commentMode && editor.tool !== 'select') editor.setTool('select')
                toggleCommentMode()
              }}
              className={cn(
                'flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                commentMode && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
              )}
            >
              <MessageCircle className="size-[18px]" strokeWidth={1.75} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="flex items-center gap-2">
            {t('tool.comments')}
            <kbd className="rounded bg-background/20 px-1.5 font-mono text-[10px]">M</kbd>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label={t('tool.web')}
              data-web-tool
              onClick={() => window.dispatchEvent(new CustomEvent('aifig:snippet-dialog', { detail: {} }))}
              className="flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Globe className="size-[18px]" strokeWidth={1.75} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{t('tool.webHint')}</TooltipContent>
        </Tooltip>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm" multiple hidden onChange={(e) => onPick(e.target.files)} />
      </div>
    </div>
  )
}
