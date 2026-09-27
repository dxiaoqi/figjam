export type Platform = 'macos' | 'windows' | 'linux'
export type Arch = 'x64' | 'arm64' | 'universal'
export type Kind = 'dmg' | 'zip' | 'exe' | 'appimage' | 'deb'

export interface ReleaseFile {
  name: string
  url: string
  platform: Platform
  arch: Arch
  kind: Kind
  size: number
  sha256: string
}

export interface Release {
  product: string
  version: string
  releasedAt: string
  baseUrl?: string
  notesUrl?: string
  files: ReleaseFile[]
}

export const PLATFORMS: Platform[] = ['macos', 'windows', 'linux']

export function parseRelease(v: unknown): Release | null {
  const r = v as Release
  if (!r || typeof r.version !== 'string' || !Array.isArray(r.files)) return null
  const files = r.files.filter((f) => f && typeof f.name === 'string' && typeof f.url === 'string' && PLATFORMS.includes(f.platform) && /^[0-9a-f]{64}$/.test(f.sha256))
  return files.length ? { ...r, files } : null
}

/** File URLs in the manifest are absolute, or relative to the manifest itself. */
export function resolveFileUrl(fileUrl: string, manifestUrl: string) {
  if (/^https?:\/\//.test(fileUrl)) return fileUrl
  if (/^https?:\/\//.test(manifestUrl)) return new URL(fileUrl, manifestUrl).toString()
  return manifestUrl.replace(/[^/]*$/, '') + fileUrl
}

export const formatSize = (bytes: number) => `${Math.round(bytes / 1e6)} MB`

/** The file a visitor on this OS/arch most likely wants: .dmg, .exe, AppImage. */
export function pickDefault(files: ReleaseFile[], platform: Platform, arch: Arch | null): ReleaseFile | null {
  const preferred: Record<Platform, Kind> = { macos: 'dmg', windows: 'exe', linux: 'appimage' }
  const mine = files.filter((f) => f.platform === platform)
  const kind = mine.filter((f) => f.kind === preferred[platform])
  const pool = kind.length ? kind : mine
  // Macs: Apple silicon unless the browser says otherwise (Safari reports "Intel" on every Mac)
  const wanted = arch ?? (platform === 'macos' ? 'arm64' : 'x64')
  return pool.find((f) => f.arch === wanted) ?? pool.find((f) => f.arch === 'universal') ?? pool[0] ?? null
}
