/**
 * Prepare the maple-branch photograph for the poster.
 *
 * WHAT THE SOURCE IS, and why it is better than anything generated
 * ---------------------------------------------------------------
 * A real photograph of maple branches against white: overlapping leaves, twigs that
 * cross, a canopy with genuine depth and occlusion. Several rounds of this project were
 * spent trying to synthesise that with recursive geometry, and the honest conclusion is
 * that a photograph has it for free and the geometry never quite did.
 *
 * THREE OPERATIONS, each with a reason:
 *
 *   1. CROP. The file carries a stock-site watermark across its bottom (measured: ink
 *      jumps from 0% to 17% of the row at y=944) while the foliage ends at y=904. So
 *      cropping to y<925 removes the watermark entirely and loses no leaves.
 *
 *   2. CUT THE GROUND. The background is white and connected to the border, so a
 *      border-seeded flood fill removes exactly it — `tools/cutout.mjs` already does
 *      this, and a global "make white transparent" threshold would punch holes through
 *      the pale highlights inside the leaves.
 *
 *   3. REMAP TO THE PAGE'S RAMP. The source is red; the page is olive. A flat recolour
 *      would throw away the tonal structure the photograph exists for, so the mapping is
 *      a DUOTONE: each pixel's own luminance picks its place on a two-stop ramp, which
 *      keeps every fold, shadow and overlap the camera recorded.
 *
 * Usage:
 *   node tools/prep-maple.mjs <in.jpg> <out.png> [--cropBottom 925] [--dark #4E5427]
 *                             [--light #FBFBF6] [--gamma 1] [--flip false]
 */

import { createCanvas, loadImage } from '@napi-rs/canvas'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, isAbsolute, dirname, join } from 'node:path'
import { parseColor } from '../src/color.mjs'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}
const input = resolve(process.cwd(), args[0])
const output = resolve(process.cwd(), args[1])
const cropBottom = Number(opt('cropBottom', 925))
const dark = parseColor(opt('dark', '#4E5427'))
const light = parseColor(opt('light', '#FBFBF6'))
const gamma = Number(opt('gamma', 1))
const flip = opt('flip', 'false') === 'true'
const trim = opt('trim', 'true')
const flipY = opt('flipY', 'false') === 'true'

const img = await loadImage(readFileSync(input))
const W = img.width
const H = Math.min(img.height, cropBottom)

const cv = createCanvas(W, H)
const ctx = cv.getContext('2d')
ctx.drawImage(img, 0, 0, W, H, 0, 0, W, H)
const imageData = ctx.getImageData(0, 0, W, H)
const d = imageData.data

// ── 1. the ground: border-seeded flood fill, so only the connected white region goes ──
//
// THE THRESHOLD IS MEASURED, NOT ASSUMED. The first version used "255 minus a tolerance"
// and cleared nothing at all: alpha 0 was 0.0% of the file, and every corner pixel came
// back at alpha 98. The reason is that this is a JPEG — its 'white' background is 245,
// not 255 — so a tolerance measured from 255 left the ground 61% opaque, which reads as a
// grey haze rather than as transparency.
//
// So the background level is taken from the image's own corners, and the ramp is built
// relative to THAT: fully clear at the measured level, fully opaque `FADE` below it, and
// feathered in between so no white fringe survives against tinted paper.
const FADE = 26
const cornerSample = []
for (const [sx, sy] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]]) {
  const i = (sy * W + sx) * 4
  cornerSample.push(Math.min(d[i], d[i + 1], d[i + 2]))
}
cornerSample.sort((a, b) => a - b)
const BG = cornerSample[1]                      // the darker of the two middle corners
const opaqueAt = BG - FADE

const whiteness = (i) => Math.min(d[i], d[i + 1], d[i + 2])
const visited = new Uint8Array(W * H)
const stack = []
for (let x = 0; x < W; x++) { stack.push(x); stack.push((H - 1) * W + x) }
for (let y = 0; y < H; y++) { stack.push(y * W); stack.push(y * W + W - 1) }
let cleared = 0
while (stack.length > 0) {
  const idx = stack.pop()
  if (visited[idx] === 1) continue
  visited[idx] = 1
  const i = idx * 4
  if (d[i + 3] === 0) continue
  const w = whiteness(i)
  // Anything at or above the measured ground is ground; the feather runs below it.
  if (w < opaqueAt) continue
  // `keep` is how much alpha to RETAIN: 0 on the ground, 1 on solid ink. The previous
  // line multiplied by `1 - keep` and therefore deleted the leaves and preserved the
  // background — alpha 0 came back as 0.0% and alpha 255 as 97%, i.e. exactly inverted.
  const keep = w >= BG ? 0 : Math.max(0, Math.min(1, (BG - w) / FADE))
  d[i + 3] = Math.round(d[i + 3] * keep)
  cleared++
  const x = idx % W
  const y = (idx - x) / W
  if (x > 0) stack.push(idx - 1)
  if (x < W - 1) stack.push(idx + 1)
  if (y > 0) stack.push(idx - W)
  if (y < H - 1) stack.push(idx + W)
}

// ── 2. the duotone: the pixel's own luminance picks its place on the ramp ──
let inked = 0
for (let i = 0; i < d.length; i += 4) {
  if (d[i + 3] === 0) continue
  const lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255
  const t = Math.pow(lum, 1 / Math.max(0.05, gamma))
  d[i] = dark.r + (light.r - dark.r) * t
  d[i + 1] = dark.g + (light.g - dark.g) * t
  d[i + 2] = dark.b + (light.b - dark.b) * t
  inked++
}
ctx.putImageData(imageData, 0, 0)

// `trim` crops the file to the ink's own bounding box, so the FILE IS THE ART and the
// scene can place it with plain positive coordinates.
//
// This exists because of a real trap in the renderer: `resolveLength` treats anything
// `<= 1` as a FRACTION of the canvas, and a negative pixel coordinate satisfies that test.
// Placing the art by an ink offset of −179 therefore rendered it at −179 × 2560 =
// −458240, i.e. far off the page, with no warning and a perfectly valid-looking report.
// Trimming the whitespace away makes the offset unnecessary.
let out = cv
if (trim === 'true') {
  let tx0 = W, ty0 = H, tx1 = 0, ty1 = 0
  const td = ctx.getImageData(0, 0, W, H).data
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (td[(y * W + x) * 4 + 3] < 8) continue
      if (x < tx0) tx0 = x
      if (x > tx1) tx1 = x
      if (y < ty0) ty0 = y
      if (y > ty1) ty1 = y
    }
  }
  const tw = tx1 - tx0 + 1
  const th = ty1 - ty0 + 1
  const tcv = createCanvas(tw, th)
  tcv.getContext('2d').drawImage(cv, tx0, ty0, tw, th, 0, 0, tw, th)
  out = tcv
}

if (flip) {
  const f = createCanvas(out.width, out.height)
  const fc = f.getContext('2d')
  fc.translate(out.width, 0)
  fc.scale(-1, 1)
  fc.drawImage(out, 0, 0)
  out = f
}

// `flipY` turns the art upside down, and the reason is compositional rather than
// aesthetic: the source's branch mass sits in the UPPER-LEFT and the page's type block is
// also in the upper-left, so the two collided no matter where the art was positioned
// within its own box. Mirroring vertically puts the mass in the LOWER-left, where the
// foliage rises past the type instead of over it — and the material is unchanged, because
// a branch has no up.
if (flipY) {
  const f = createCanvas(out.width, out.height)
  const fc = f.getContext('2d')
  fc.translate(0, out.height)
  fc.scale(1, -1)
  fc.drawImage(out, 0, 0)
  out = f
}

writeFileSync(output, out.encodeSync('png'))

// The ink's bounding box, so the scene can place the art by its actual content rather
// than by its file size — the same class of mistake the leaf assets already suffered.
let x0 = W, y0 = H, x1 = 0, y1 = 0
const od = out.getContext('2d').getImageData(0, 0, W, H).data
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (od[(y * W + x) * 4 + 3] < 8) continue
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
}

console.log(JSON.stringify({
  ok: true,
  input,
  output,
  size: { width: W, height: H },
  croppedOff: img.height - H,
  groundClearedPixels: cleared,
  groundClearedShare: Math.round((cleared / (W * H)) * 1000) / 1000,
  inkedPixels: inked,
  inkedShare: Math.round((inked / (W * H)) * 1000) / 1000,
  inkBox: { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 },
  ramp: { dark: opt('dark', '#4E5427'), light: opt('light', '#FBFBF6'), gamma },
}, null, 2))
