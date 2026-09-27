import { Bookmark, Check, ChevronDown, FolderOpen, HardDrive, History, Pencil, Plus, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { FEATURES } from '@aifig/shared'
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
import { openBackupFolder, openVersionHistory } from '../lib/versions'
import { useT } from '../i18n'
import { openNewBoard } from './new-board'
import { openStorage } from './StoragePanel'

const CURSOR = 'M14 14L26 18.5L20 20L18.5 26Z'

/** The app icon's small tile (assets/brand/icon-small.svg): a sticky with an agent cursor on it. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="7.5" fill="#1C1917" />
      <rect x="6" y="6" width="12" height="12" rx="2" fill="#FFF1B8" />
      <path d={CURSOR} fill="#D97757" stroke="#1C1917" strokeWidth="3" strokeLinejoin="round" />
      <path d={CURSOR} fill="#D97757" stroke="#D97757" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  )
}

/** The monochrome mark (assets/brand/mark.svg), drawn in the current text color. */
export function Mark({ className }: { className?: string }) {
  const id = useId()
  return (
    <svg viewBox="5 5 22 22" fill="currentColor" className={className} aria-hidden>
      <mask id={id} maskUnits="userSpaceOnUse" x="5" y="5" width="22" height="22">
        <rect x="5" y="5" width="22" height="22" fill="#FFFFFF" />
        <path d={CURSOR} stroke="#000000" strokeWidth="4" strokeLinejoin="round" />
      </mask>
      <rect x="6" y="6" width="12" height="12" rx="2" mask={`url(#${id})`} />
      <path d={CURSOR} stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  )
}

export function BoardMenu() {
  const { boards, boardId, switchBoard, refreshBoards } = useBoard()
  const { status } = useProviderState()
  const title = useBoardTitle()
  const t = useT()
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
      toast.success(t('board.deleted', { title }))
      const next = boards.find((b) => b.id !== boardId)
      refreshBoards()
      if (next) switchBoard(next.id)
      else window.location.reload()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const dot = status === 'connected' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-red-500'
  const dotLabel = t(status === 'connected' ? 'board.synced' : status === 'connecting' ? 'board.connecting' : 'board.offline')

  return (
    <div className="pointer-events-auto m-3 flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="chrome flex h-10 items-center gap-2.5 rounded-xl pr-3 pl-2 text-sm font-medium transition-colors hover:bg-accent/60">
            <Mark className="size-5" />
            <span className="max-w-[40vw] truncate">{title || t('board.untitled')}</span>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t('board.onMachine')}</DropdownMenuLabel>
          <div className="max-h-72 overflow-y-auto">
            {boards.map((b) => (
              <DropdownMenuItem key={b.id} onSelect={() => switchBoard(b.id)} className="flex items-center gap-2">
                <Check className={cn('size-4', b.id === boardId ? 'opacity-100' : 'opacity-0')} />
                <span className="flex-1 truncate">{b.title}</span>
                {b.pendingChangeSets > 0 && (
                  <span className="rounded-full bg-violet-500/15 px-1.5 text-[10px] font-medium text-violet-600 dark:text-violet-300">{t('board.toReview', { count: b.pendingChangeSets })}</span>
                )}
                <span className="text-xs text-muted-foreground tabular-nums">{b.blockCount}</span>
              </DropdownMenuItem>
            ))}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openNewBoard()} data-menu-new-board>
            <Plus className="size-4" /> {t('board.newEllipsis')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setDraft(title)
              setRenaming(true)
            }}
          >
            <Pencil className="size-4" /> {t('board.rename')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openVersionHistory()} data-menu-versions>
            <History className="size-4" /> {t('board.versionHistory')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openVersionHistory({ checkpoint: true })}>
            <Bookmark className="size-4" /> {t('board.saveCheckpoint')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openBackupFolder(boardId)}>
            <FolderOpen className="size-4" /> {t('board.openBackups')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openStorage()} data-menu-storage>
            <HardDrive className="size-4" /> {t('board.storage')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => window.dispatchEvent(new Event('aifig:activity'))}>
            <ShieldCheck className="size-4" /> {t('board.activity')}
          </DropdownMenuItem>
          {FEATURES.assistant && (
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new Event('aifig:assistant-settings'))}>
              <Sparkles className="size-4" /> {t('board.assistantSettings')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
            <Trash2 className="size-4" /> {t('board.delete')}
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
            <DialogTitle>{t('board.renameTitle')}</DialogTitle>
            <DialogDescription>{t('board.renameHint')}</DialogDescription>
          </DialogHeader>
          <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && rename()} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={rename} disabled={!draft.trim()}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('board.deleteTitle', { title })}</DialogTitle>
            <DialogDescription>{t('board.deleteHint')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              {t('board.keep')}
            </Button>
            <Button variant="destructive" onClick={remove}>
              {t('board.deleteConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
