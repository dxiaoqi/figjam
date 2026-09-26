/** Bridge exposed by the Electron preload (undefined in the browser). */
export interface DesktopBridge {
  platform: string
  /** the core's access token, read by the shell from AIFIG_HOME */
  token?: string
  /** web snippets run in <webview> with a partition per snippet */
  snippetWebviews?: boolean
  onMenu(cb: (action: string, payload?: unknown) => void): () => void
  reportState(state: { boardId: string | null; title: string }): void
  assistant: {
    get(): Promise<{ provider: string | null; model: string; baseUrl: string; hasKey: boolean; encryption: string }>
    save(settings: { provider: string | null; model?: string; baseUrl?: string; key?: string }): Promise<{ ok: boolean }>
  }
}

export const desktop: DesktopBridge | undefined = (globalThis as { aifigDesktop?: DesktopBridge }).aifigDesktop
