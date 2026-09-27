// Small media files for tests (tests/fixtures/media), copied to a temp folder so tests never touch the originals.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/media')

export function makeMedia(into) {
  fs.mkdirSync(into, { recursive: true })
  const copy = (name) => {
    const to = path.join(into, name)
    fs.copyFileSync(path.join(dir, name), to)
    return to
  }
  return { png: copy('whiteboard.png'), png2: copy('whiteboard-v2.png'), mp4: copy('teaser.mp4'), webm: copy('walkthrough.webm') }
}
