import { Moon, Plug, Settings, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { AgentPresence } from '@aifig/shared'
import { useAgentsOnBoard, useBoard } from '../board-context'
import { ConnectDialog } from './ConnectDialog'
import { HistoryMenu } from './HistoryMenu'
import { openSettings } from './SettingsDialog'
import { useT } from '../i18n'

export function useNow(interval = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(t)
  }, [interval])
  return now
}

export function AgentAvatar({ agent, active, className }: { agent: Pick<AgentPresence, 'name' | 'color'>; active?: boolean; className?: string }) {
  return (
    <span
      className={cn('relative flex size-7 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ring-background', className)}
      style={{ background: agent.color }}
    >
      {agent.name.slice(0, 1).toUpperCase()}
      {active && <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />}
    </span>
  )
}

function AgentsList() {
  const agents = useAgentsOnBoard()
  const now = useNow()
  const t = useT()
  if (!agents.length) return null
  const sorted = [...agents].sort((a, b) => b.lastActive - a.lastActive)
  const lead = sorted[0]
  const leadActive = now - lead.lastActive < 15_000
  return (
    <div className="chrome flex h-10 items-center gap-2 rounded-xl pr-3 pl-1.5">
      <div className="flex -space-x-2">
        {sorted.slice(0, 4).map((a) => (
          <Tooltip key={a.id}>
            <TooltipTrigger asChild>
              <span>
                <AgentAvatar agent={a} active={now - a.lastActive < 15_000} />
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {a.name}
              {a.status ? ` — ${a.status}` : ` — ${t(now - a.lastActive < 15_000 ? 'agents.active' : 'agents.idle')}`}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className="flex max-w-[220px] min-w-0 flex-col leading-tight">
        <span className="truncate text-xs font-medium">{sorted.length === 1 ? lead.name : `${lead.name} +${sorted.length - 1}`}</span>
        <span className="truncate text-[11px] text-muted-foreground">{leadActive ? (lead.status ?? t('agents.working')) : t('agents.idleCap')}</span>
      </div>
    </div>
  )
}

export function TopRight() {
  const { theme, setTheme } = useBoard()
  const [connectOpen, setConnectOpen] = useState(false)
  const t = useT()
  useEffect(() => {
    const open = () => setConnectOpen(true)
    window.addEventListener('aifig:connect', open)
    return () => window.removeEventListener('aifig:connect', open)
  }, [])
  return (
    <div className="pointer-events-auto m-3 flex items-center gap-2">
      <AgentsList />
      <div className="chrome flex h-10 items-center gap-0.5 rounded-xl px-1">
        <HistoryMenu />
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 rounded-lg px-2.5 text-[13px]" onClick={() => setConnectOpen(true)}>
          <Plug className="size-4" strokeWidth={1.75} />
          <span className="hidden sm:inline">{t('top.connect')}</span>
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 rounded-lg" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={t('top.toggleTheme')}>
              {theme === 'dark' ? <Sun className="size-4" strokeWidth={1.75} /> : <Moon className="size-4" strokeWidth={1.75} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t(theme === 'dark' ? 'top.lightMode' : 'top.darkMode')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 rounded-lg" onClick={openSettings} aria-label={t('top.settings')} data-open-settings>
              <Settings className="size-4" strokeWidth={1.75} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('top.settings')}</TooltipContent>
        </Tooltip>
      </div>
      <ConnectDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </div>
  )
}
