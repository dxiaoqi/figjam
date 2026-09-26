/** Bridge exposed by the Electron preload (undefined in the browser). */
export interface DesktopBridge {
  platform: string
  onMenu(cb: (action: string, payload?: unknown) => void): () => void
  reportState(state: { boardId: string | null; title: string }): void
  /** Older shells don't have it. */
  setLocale?(locale: string, pref: string): void
  assistant: {
    get(): Promise<{ provider: string | null; model: string; baseUrl: string; hasKey: boolean; encryption: string }>
    save(settings: { provider: string | null; model?: string; baseUrl?: string; key?: string }): Promise<{ ok: boolean }>
  }
}

export const desktop: DesktopBridge | undefined = (globalThis as { aifigDesktop?: DesktopBridge }).aifigDesktop
