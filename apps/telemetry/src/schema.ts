import { z } from 'zod'

// Strict objects: an unknown field fails validation, so nothing beyond these fields can ever be stored.

export const EventPing = z.strictObject({
  v: z.literal(1),
  event: z.enum(['install', 'active']),
  installId: z.uuid(),
  appVersion: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}(-[0-9A-Za-z.-]{1,20})?$/),
  os: z.enum(['macos', 'windows', 'linux', 'other']),
  arch: z.enum(['x64', 'arm64', 'ia32', 'arm', 'other']),
  locale: z.string().regex(/^([a-z]{2,3}(-([A-Z]{2}|\d{3}))?|und)$/),
})

export const DownloadPing = z.strictObject({
  v: z.literal(1),
  platform: z.enum(['macos', 'windows', 'linux']),
  arch: z.enum(['x64', 'arm64', 'universal']),
  kind: z.enum(['dmg', 'zip', 'exe', 'appimage', 'deb']),
  version: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}(-[0-9A-Za-z.-]{1,20})?$/),
  source: z.enum(['website', 'direct']).default('website'),
})

export type EventPing = z.infer<typeof EventPing>
export type DownloadPing = z.infer<typeof DownloadPing>
