// Derived SVG variants of the master icon, shared by scripts/brand-icons.mjs and the website's OG image script.
import fs from 'node:fs'

const read = (name) => fs.readFileSync(new URL(name, import.meta.url), 'utf8')
export const master = () => read('icon.svg')
export const small = () => read('icon-small.svg')
export const mark = () => read('mark.svg')

// Apple's grid puts an 824 body on a 1024 canvas; the same ratio pads the 32-unit small tile
const PAD = (32 * 1024) / 824
const setViewBox = (svg, vb) => svg.replace(/viewBox="[^"]*"/, `viewBox="${vb}"`)

/** Master without the macOS padding and drop shadow (Windows, Linux, web); `square` fills the corners (apple-touch-icon, PWA). */
export function flat({ square = false } = {}) {
  let svg = setViewBox(master().replace(/\s*<use id="drop"[^>]*\/>/, ''), square ? '100 100 824 824' : '92 92 840 840')
  if (square) svg = svg.replace(/<path id="body" d="[^"]*"\/>/, '<path id="body" d="M100 100H924V924H100Z"/>')
  return svg
}

/** The small tile padded onto the macOS grid, for the 16/32 slots of the .icns. */
export const smallOnMacGrid = () => setViewBox(small(), `${(32 - PAD) / 2} ${(32 - PAD) / 2} ${PAD} ${PAD}`)

/** The mark in one flat color (tray templates are black on transparent). */
export const markIn = (color) => mark().replaceAll('currentColor', color)
