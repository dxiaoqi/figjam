// Screen recording through a CDP screencast, encoded with the system ffmpeg (Playwright's recorder needs its own).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export async function startClip(page, tmp) {
  const cdp = await page.context().newCDPSession(page)
  const frames = []
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp })
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1600, maxHeight: 1000, everyNthFrame: 1 })
  return async (out) => {
    await cdp.send('Page.stopScreencast').catch(() => {})
    if (!frames.length) return
    const dir = fs.mkdtempSync(path.join(tmp, 'clip-'))
    const fps = 25
    const t0 = frames[0].t
    const end = frames.at(-1).t + 1
    let j = 0
    for (let i = 0, t = t0; t < end; i++, t = t0 + i / fps) {
      while (j + 1 < frames.length && frames[j + 1].t <= t) j++
      fs.writeFileSync(path.join(dir, `${String(i).padStart(5, '0')}.jpg`), Buffer.from(frames[j].data, 'base64'))
    }
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, '%05d.jpg'), '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out])
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
