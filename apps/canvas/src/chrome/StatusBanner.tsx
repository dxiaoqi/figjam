import { WifiOff } from 'lucide-react'
import { useProviderState } from '../board-context'
import { tn, useT } from '../i18n'

export function StatusBanner() {
  const { status } = useProviderState()
  useT()
  if (status !== 'offline') return null
  return (
    <div className="pointer-events-auto absolute top-16 left-1/2 z-[400] -translate-x-1/2 animate-in fade-in slide-in-from-top-2">
      <div className="chrome flex items-center gap-2.5 rounded-full py-2 pr-4 pl-3 text-xs">
        <WifiOff className="size-3.5 text-red-500" />
        <span>{tn('banner.offline', { cmd: <code className="rounded bg-muted px-1 font-mono">npm run core</code> })}</span>
      </div>
    </div>
  )
}
