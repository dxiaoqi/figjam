import { Check, ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useBoard, useBoardTitle, useProviderState } from '../board-context'
import { callCore } from '../lib/core'

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-foreground" />
      <rect x="7" y="7" width="11" height="11" rx="2" fill="#FFF1B8" />
      <rect x="14" y="14" width="11" height="11" rx="3" fill="#E8DEFF" />
    </svg>
  )
}

export function BoardMenu() {
  const { boards, boardId, switchBoard, createBoard, refreshBoards } = useBoard()
  const { status } = useProviderState()
  const title = useBoardTitle()
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const rename = async () => {
    const t = draft.trim()
    if (!t) return
    try {
      await callCore('rename_board', { board: boardId, title: t })
      refreshBoards()
      setRenaming(false)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const remove = async () => {
    try {
      await callCore('delete_board', { board: boardId })
      setConfirmDelete(false)
      toast.success(`Deleted “${title}”`)
      const next = boards.find((b) => b.id !== boardId)
      refreshBoards()
      if (next) switchBoard(next.id)
      else window.location.reload()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const dot = status === 'connected' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-red-500'
  const dotLabel = status === 'connected' ? 'Synced with the local core' : status === 'connecting' ? 'Connecting to the core…' : 'Offline — retrying'

  return (
    <div className="pointer-events-auto m-3 flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="chrome flex h-10 items-center gap-2.5 rounded-xl pr-3 pl-2 text-sm font-medium transition-colors hover:bg-accent/60">
            <Logo className="size-6" />
            <span className="max-w-[40vw] truncate">{title || 'Untitled board'}</span>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Boards on this machine</DropdownMenuLabel>
          <div className="max-h-72 overflow-y-auto">
            {boards.map((b) => (
              <DropdownMenuItem key={b.id} onSelect={() => switchBoard(b.id)} className="flex items-center gap-2">
                <Check className={cn('size-4', b.id === boardId ? 'opacity-100' : 'opacity-0')} />
                <span className="flex-1 truncate">{b.title}</span>
                {b.pendingChangeSets > 0 && (
                  <span className="rounded-full bg-violet-500/15 px-1.5 text-[10px] font-medium text-violet-600 dark:text-violet-300">{b.pendingChangeSets} to review</span>
                )}
                <span className="text-xs text-muted-foreground tabular-nums">{b.blockCount}</span>
              </DropdownMenuItem>
            ))}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={createBoard}>
            <Plus className="size-4" /> New board
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setDraft(title)
              setRenaming(true)
            }}
          >
            <Pencil className="size-4" /> Rename…
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
            <Trash2 className="size-4" /> Delete board…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex size-6 items-center justify-center">
            <span className={cn('size-2 rounded-full', dot)} />
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">{dotLabel}</TooltipContent>
      </Tooltip>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename board</DialogTitle>
            <DialogDescription>Agents can refer to this board by its title.</DialogDescription>
          </DialogHeader>
          <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && rename()} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button onClick={rename} disabled={!draft.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{title}”?</DialogTitle>
            <DialogDescription>The board file is removed from disk. This can’t be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={remove}>
              Delete board
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
