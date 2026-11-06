/**
 * prep-plate — bring a photographic crop onto the page's own craft.
 *
 * WHY THIS EXISTS. A raw screenshot pasted into a vector page reads as a
 * different medium: its tonality, its hard rectangular edge and its colour all
 * belong to another process. The fix is not a translucent colour rectangle laid
 * over it — a rectangle cannot follow the subject, so wherever it extends past
 * the subject's ink it becomes a free-floating soft-edged box. The fix is to put
 * the image THROUGH the page's process:
 *
 *   1. DUOTONE into the page's own two inks, so the crop and the page share one
 *      ink and one paper. A crop re-inked into the deck's palette stops arguing
 *      with the type.
 *   2. FEATHER the alpha at the edges, so the plate dissolves into the ground
 *      instead of ending on a ruled line. Optionally with a soft outer bloom that
 *      reads as a glow where the ground is dark.
 *
 * Both are computed per pixel here rather than approximated with stacked
 * translucent rectangles.
 *
 * Usage: node tools/prep-plate.mjs <in.png> <out.png> [opts]
 *   --dark  #08090A   shadow ink            (default: the deck ground)
 *   --mid   #4A4E4C   optional midtone ink
 *   --light #C3C3BF   highlight ink
 *   --feather N       feather width in px   (default 90; 0 disables)
 *   --bloom N         outer bloom width px  (default 0)
 *   --bloomInk #FFFA00  bloom colour        (default: same as light)
 *   --mix F           0=original 1=full duotone (default 1)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const argv = process.argv.slice(2)
const src = argv[0], dst = argv[1]
if (!src || !dst) { console.log('usage: prep-plate <in.png> <out.png> [--dark #.. --light #.. --feather N --bloom N --bloomInk #.. --mix F]'); process.exit(2) }
const opt = {}
for (let i = 2; i < argv.length; i++) if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1]

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const DARK = hex(opt.dark ?? '#08090A')
const HAS_MID = !!opt.mid
const MID = HAS_MID ? hex(opt.mid) : null
const LIGHT = hex(opt.light ?? '#C3C3BF')
const FEATHER = Number(opt.feather ?? 90)
const BLOOM = Number(opt.bloom ?? 0)
const BLOOMINK = hex(opt.bloomInk ?? (opt.light ?? '#C3C3BF'))
const MIX = Number(opt.mix ?? 1)

const img = await loadImage(readFileSync(src))
const W = img.width, H = img.height
const cv = createCanvas(W, H)
const ctx = cv.getContext('2d')
ctx.drawImage(img, 0, 0)
const im = ctx.getImageData(0, 0, W, H)
const d = im.data

/** luminance -> the page's ink ramp, in two or three stops */
function ramp(l) {
  if (HAS_MID) {
    return l < 0.5
      ? DARK.map((c, i) => c + (MID[i] - c) * (l / 0.5))
      : MID.map((c, i) => c + (LIGHT[i] - c) * ((l - 0.5) / 0.5))
  }
  return DARK.map((c, i) => c + (LIGHT[i] - c) * l)
}

/** edge alpha: 1 in the middle, easing to 0 across FEATHER px of the border */
function edgeAlpha(x, y) {
  if (FEATHER <= 0) return 1
  const dx = Math.min(x, W - 1 - x), dy = Math.min(y, H - 1 - y)
  const t = Math.min(dx, dy) / FEATHER
  if (t >= 1) return 1
  const s = t < 0 ? 0 : t
  return s * s * (3 - 2 * s)            // smoothstep, so no band at the end of the ramp
}

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255
    const rgb = ramp(l)
    for (let c = 0; c < 3; c++) {
      const orig = d[i + c]
      d[i + c] = Math.round(orig + (rgb[c] - orig) * MIX)
    }
    const a = edgeAlpha(x, y)
    const src_a = d[i + 3] / 255
    d[i + 3] = Math.round(255 * a * src_a)
  }
}
ctx.putImageData(im, 0, 0)

// optional outer bloom: a soft halo just outside the plate, on transparent pixels
if (BLOOM > 0) {
  const halo = createCanvas(W, H)
  const hc = halo.getContext('2d')
  hc.drawImage(cv, 0, 0)
  const hi = hc.getImageData(0, 0, W, H)
  const hd = hi.data
  const copy = new Uint8ClampedArray(hd)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      if (copy[i + 3] > 8) continue                     // only outside the plate
      let acc = 0
      const R = BLOOM
      for (let k = 1; k <= R; k += Math.max(1, (R / 6) | 0)) {
        for (const [ox, oy] of [[k, 0], [-k, 0], [0, k], [0, -k]]) {
          const nx = x + ox, ny = y + oy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const j = (ny * W + nx) * 4
          acc = Math.max(acc, copy[j + 3] / 255 * (1 - k / R))
        }
      }
      if (acc > 0) {
        hd[i] = BLOOMINK[0]; hd[i + 1] = BLOOMINK[1]; hd[i + 2] = BLOOMINK[2]
        hd[i + 3] = Math.round(255 * acc * 0.5)
      }
    }
  }
  hc.putImageData(hi, 0, 0)
  ctx.clearRect(0, 0, W, H)
  ctx.drawImage(halo, 0, 0)
  ctx.drawImage(cv, 0, 0)                                // plate back on top
}

mkdirSync(dirname(dst), { recursive: true })
writeFileSync(dst, await cv.encode('png'))
console.log(`${src} -> ${dst}  ${W}x${H}  duotone ${DARK.map(v => v.toString(16).padStart(2, '0')).join('')}→${LIGHT.map(v => v.toString(16).padStart(2, '0')).join('')}  feather ${FEATHER}px  bloom ${BLOOM}px  mix ${MIX}`)
