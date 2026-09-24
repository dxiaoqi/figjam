import { History, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ChangeSet } from '@aifig/shared'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useBoard, useChangeSets } from '../board-context'
import { authorLabel, groupAuthors } from '../lib/authors'
import { callCore } from '../lib/core'

const STATUS: Record<ChangeSet['status'], { label: string; cls: string }> = {
  open: { label: 'working', cls: 'bg-violet-500/15 text-violet-600 dark:text-violet-300' },
  pending: { label: 'to review', cls: 'bg-violet-500/15 text-violet-600 dark:text-violet-300' },
  accepted: { label: 'accepted', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  partial: { label: 'partly accepted', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  rejected: { label: 'rejected', cls: 'bg-muted text-muted-foreground' },
  undone: { label: 'undone', cls: 'bg-muted text-muted-foreground' },
}

/** Change history with undo per change set, or everything by one agent (also after accepting). */
export function HistoryMenu() {
  const { boardId } = useBoard()
  const sets = useChangeSets()
  const recent = [...sets].sort((a, b) => b.createdAt - a.createdAt).slice(0, 50)
  const labels = groupAuthors(sets)
  const undoable = groupAuthors(sets.filter((c) => c.status !== 'rejected' && c.status !== 'undone'))
  const multi = undoable.length > 1

  const undo = async (args: { authors?: string[]; change_set?: string }, label: string) => {
    try {
      const r = await callCore<{ reverted: number; kept: unknown[] }>('undo_changes', { board: boardId, ...args })
      toast.success(`Undid ${label}`, { description: `${r.reverted} item${r.reverted === 1 ? '' : 's'} reverted${r.kept.length ? ` · kept ${r.kept.length} you edited since` : ''}` })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 rounded-lg" aria-label="History">
              <History className="size-4" strokeWidth={1.75} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Agent history &amp; undo</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-80 p-0" data-ui data-history-menu>
        <DropdownMenuLabel className="flex items-center justify-between px-3 pt-2.5 pb-1.5 text-xs font-normal text-muted-foreground">
          Recent agent changes
          {sets.length > 0 && <span className="tabular-nums">{sets.length}</span>}
        </DropdownMenuLabel>
        {!recent.length && <div className="px-3 pb-3 text-xs text-muted-foreground">No agent changes on this board yet.</div>}
        {recent.length > 0 && (
          <div className="max-h-[min(360px,55vh)] overflow-y-auto overscroll-contain px-1 pb-1" data-history-list>
            {recent.map((c) => (
              <DropdownMenuItem
                key={c.id}
                disabled={c.status === 'rejected' || c.status === 'undone'}
                onSelect={() => undo({ change_set: c.id }, `“${c.intent}”`)}
                className="group flex items-start gap-2"
              >
                <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: c.author.color ?? '#6E56CF' }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{c.intent}</span>
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="truncate">{authorLabel(labels, c.author)}</span>
                    <span className={`shrink-0 rounded px-1 text-[10px] ${STATUS[c.status].cls}`}>{STATUS[c.status].label}</span>
                  </span>
                </span>
                {c.status !== 'rejected' && c.status !== 'undone' && <Undo2 className="mt-1 size-3.5 opacity-40 group-focus:opacity-80" aria-label="Undo this change" />}
              </DropdownMenuItem>
            ))}
          </div>
        )}
        {undoable.length > 0 && (
          <>
            <DropdownMenuSeparator className="my-0" />
            <div className="p-1">
              {multi ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="text-xs text-muted-foreground" data-undo-all>
                    <Undo2 className="size-3.5" /> Undo everything by…
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-60" data-ui>
                    {undoable.map((g) => (
                      <DropdownMenuItem key={g.key} onSelect={() => undo({ authors: g.ids }, `everything by ${g.label}`)} className="text-xs" data-undo-author={g.label}>
                        <span className="size-2 shrink-0 rounded-full" style={{ background: g.color ?? '#6E56CF' }} />
                        <span className="flex-1 truncate">{g.label}</span>
                        <span className="text-[11px] text-muted-foreground tabular-nums">{g.sets}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : (
                <DropdownMenuItem onSelect={() => undo({ authors: undoable[0].ids }, `everything by ${undoable[0].label}`)} className="text-xs text-muted-foreground" data-undo-all data-undo-author={undoable[0].label}>
                  <Undo2 className="size-3.5" /> Undo everything by {undoable[0].label}
                </DropdownMenuItem>
              )}
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
