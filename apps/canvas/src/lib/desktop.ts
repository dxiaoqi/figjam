/** Bridge exposed by the Electron preload (undefined in the browser). */
export interface DesktopBridge {
  platform: string
  /** the core's access token, read by the shell from AIFIG_HOME */
  token?: string
  /** web snippets run in <webview> with a partition per snippet */
  snippetWebviews?: boolean
  onMenu(cb: (action: string, payload?: unknown) => void): () => void
  reportState(state: { boardId: string | null; title: string }): void
  /** Older shells don't have it. */
  setLocale?(locale: string, pref: string): void
  /** Native folder picker (pack import destination). */
  pickFolder?(defaultPath?: string): Promise<string | null>
  /** Native save dialog for a pack or web export; null when cancelled. */
  savePath?(opts: { defaultName: string; kind: 'pack' | 'zip' | 'html' | 'folder' }): Promise<string | null>
  /** Select a file the app just wrote in Finder / Explorer. */
  revealPath?(file: string): void
  /** Only when the build has the built-in assistant (see FEATURES). */
  assistant?: {
    get(): Promise<{ provider: string | null; model: string; baseUrl: string; hasKey: boolean; encryption: string }>
    save(settings: { provider: string | null; model?: string; baseUrl?: string; key?: string }): Promise<{ ok: boolean }>
  }
  /** Anonymous install counting; older shells don't have it. */
  telemetry?: {
    status(): Promise<TelemetryStatus>
    set(granted: boolean): Promise<TelemetryStatus>
  }
}

export interface TelemetryStatus {
  /** an endpoint is configured for this build (otherwise telemetry is a no-op and the UI hides it) */
  configured: boolean
  /** AIFIG_TELEMETRY=off or DO_NOT_TRACK=1 */
  envDisabled: boolean
  consent: 'granted' | 'denied' | null
  enabled: boolean
  /** exactly the fields a ping carries */
  preview: Record<string, string | number | undefined>
}

export const desktop: DesktopBridge | undefined = (globalThis as { aifigDesktop?: DesktopBridge }).aifigDesktop
