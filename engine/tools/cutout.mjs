/**
 * Cut the white ground out of a character illustration.
 *
 * A flood fill from the border rather than a global "make white transparent"
 * threshold, because the illustration itself contains white — the coat, the
 * boots, the highlights. A global threshold punches holes straight through the
 * figure; a border-seeded fill only removes the connected background region,
 * which is the only thing that should go.
 *
 * The fill is tolerant of near-white (JPEG and resampling leave the background
 * at 250-255 rather than a clean 255) and feathers the boundary by a few levels
 * so the cutout edge does not show a hard white fringe against a tinted ground.
 *
 * Usage: node tools/cutout.mjs <input.png> <output.png> [--tolerance 12] [--feather 26]
 */

import { createCanvas, loadImage } from '@napi-rs/canvas'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, isAbsolute } from 'node:path'

const args = process.argv.slice(2)
const input = args[0]
const output = args[1]
if (input === undefined || output === undefined) {
  console.error('usage: node tools/cutout.mjs <input.png> <output.png> [--tolerance N] [--feather N]')
  process.exit(1)
}
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback
}
const tolerance = opt('tolerance', 12)
const feather = opt('feather', 26)

const path = isAbsolute(input) ? input : resolve(process.cwd(), input)
const img = await loadImage(readFileSync(path))
const W = img.width
const H = img.height
const canvas = createCanvas(W, H)
const ctx = canvas.getContext('2d')
ctx.drawImage(img, 0, 0)
const imageData = ctx.getImageData(0, 0, W, H)
const d = imageData.data

// "Backgroundness": how close a pixel is to pure white on its darkest channel.
// Using the minimum channel means a saturated colour is never background, and a
// light grey inside the illustration survives.
const whiteness = (i) => Math.min(d[i], d[i + 1], d[i + 2])

const visited = new Uint8Array(W * H)
const stack = []
for (let x = 0; x < W; x++) {
  stack.push(x)
  stack.push((H - 1) * W + x)
}
for (let y = 0; y < H; y++) {
  stack.push(y * W)
  stack.push(y * W + W - 1)
}

let cleared = 0
while (stack.length > 0) {
  const idx = stack.pop()
  if (visited[idx] === 1) continue
  const i = idx * 4
  if (d[i + 3] === 0) { visited[idx] = 1; continue }
  const w = whiteness(i)
  if (w < 255 - tolerance) { visited[idx] = 1; continue }
  visited[idx] = 1

  // Feather: the closer to pure white, the more transparent. The boundary
  // pixels keep partial alpha, which is what stops a white fringe.
  const t = (w - (255 - tolerance)) / Math.max(1, tolerance)
  const alpha = Math.max(0, Math.min(1, 1 - t))
  d[i + 3] = Math.round(d[i + 3] * alpha)
  if (alpha > 0) {
    // Un-premultiply toward the ground colour so a soft edge does not darken.
    const push = (255 * (1 - alpha)) / Math.max(0.001, alpha)
    d[i] = Math.min(255, d[i] + push)
    d[i + 1] = Math.min(255, d[i + 1] + push)
    d[i + 2] = Math.min(255, d[i + 2] + push)
  }
  cleared++

  const x = idx % W
  const y = (idx - x) / W
  if (x > 0) stack.push(idx - 1)
  if (x < W - 1) stack.push(idx + 1)
  if (y > 0) stack.push(idx - W)
  if (y < H - 1) stack.push(idx + W)
}

// A second pass: pixels that are background-white but were enclosed by the
// figure (gaps between an arm and the body, inside a staff ring) are not
// reachable from the border. Detect them as fully connected regions of
// near-white that are small relative to the canvas and clear them too.
let enclosed = 0
for (let idx = 0; idx < W * H; idx++) {
  if (visited[idx] === 1) continue
  const i = idx * 4
  if (d[i + 3] === 0) continue
  if (whiteness(i) < 255 - tolerance) continue

  const region = []
  const local = [idx]
  visited[idx] = 1
  let touchesLarge = false
  while (local.length > 0) {
    const cur = local.pop()
    region.push(cur)
    if (region.length > W * H * 0.02) { touchesLarge = true; break }
    const cx = cur % W
    const cy = (cur - cx) / W
    const nb = [
      cx > 0 ? cur - 1 : -1,
      cx < W - 1 ? cur + 1 : -1,
      cy > 0 ? cur - W : -1,
      cy < H - 1 ? cur + W : -1,
    ]
    for (const n of nb) {
      if (n < 0 || visited[n] === 1) continue
      const ni = n * 4
      if (d[ni + 3] === 0 || whiteness(ni) < 255 - tolerance) { visited[n] = 1; continue }
      visited[n] = 1
      local.push(n)
    }
  }
  if (touchesLarge) continue
  for (const cur of region) {
    const ci = cur * 4
    const w = whiteness(ci)
    const t = (w - (255 - tolerance)) / Math.max(1, tolerance)
    const alpha = Math.max(0, Math.min(1, 1 - t))
    d[ci + 3] = Math.round(d[ci + 3] * alpha)
    enclosed++
  }
}

ctx.putImageData(imageData, 0, 0)

const outPath = isAbsolute(output) ? output : resolve(process.cwd(), output)
writeFileSync(outPath, canvas.encodeSync('png'))

const total = W * H
console.log(JSON.stringify({
  ok: true,
  input: path,
  output: outPath,
  size: { width: W, height: H },
  borderClearedPixels: cleared,
  enclosedClearedPixels: enclosed,
  clearedShare: Math.round(((cleared + enclosed) / total) * 1000) / 1000,
  tolerance,
}, null, 2))
