/**
 * zone-tone — mean luminance of named rectangles inside the SOURCE cutout.
 *
 * Needed because the new composition places a data plate OVER the illustration,
 * the way the official key visual does, and a chip can only carry type if what
 * is behind it is light enough. That is a measurement of the drawing, not a
 * judgement about it, so it belongs in a tool rather than in my head.
 *
 * Only pixels the cutout actually covers are counted — transparent pixels have
 * RGB 0,0,0 and would otherwise read as black and condemn every zone.
 *
 * Usage: node tools/zone-tone.mjs <png> x0 y0 x1 y1 [x0 y0 x1 y1 ...]
 *        coordinates are fractions of the cutout's own canvas.
 */
import { readFileSync } from 'node:fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const src = process.argv[2]
const rects = process.argv.slice(3)

const img = await loadImage(readFileSync(src))
const W = img.width, H = img.height
const cv = createCanvas(W, H)
const ctx = cv.getContext('2d')
ctx.drawImage(img, 0, 0)
const d = ctx.getImageData(0, 0, W, H).data

const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

for (let i = 0; i + 3 < rects.length; i += 4) {
  const x0 = Math.round(Number(rects[i]) * W), y0 = Math.round(Number(rects[i + 1]) * H)
  const x1 = Math.round(Number(rects[i + 2]) * W), y1 = Math.round(Number(rects[i + 3]) * H)
  let s = 0, n = 0, sr = 0, sg = 0, sb = 0, covered = 0
  let minL = 1, maxL = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * W + x) * 4
      if (d[o + 3] < 200) continue
      const r = d[o], g = d[o + 1], b = d[o + 2]
      const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      s += L; n++
      sr += r; sg += g; sb += b
      if (L < minL) minL = L
      if (L > maxL) maxL = L
    }
  }
  covered = n / ((x1 - x0) * (y1 - y0))
  if (n === 0) {
    console.log(`x[${rects[i]}..${rects[i + 2]}] y[${rects[i + 1]}..${rects[i + 3]}]  EMPTY (no opaque pixels)`)
    continue
  }
  const mL = s / n
  const ratio = mL > 0.5 ? (mL + 0.05) / 0.05 : 1.05 / (mL + 0.05)
  console.log(
    `x[${rects[i]}..${rects[i + 2]}] y[${rects[i + 1]}..${rects[i + 3]}]`,
    ` coverage ${(covered * 100).toFixed(0).padStart(3)}%`,
    ` meanL ${mL.toFixed(3)}`,
    ` range ${minL.toFixed(2)}-${maxL.toFixed(2)}`,
    ` meanColour ${hex(sr / n, sg / n, sb / n)}`,
    ` | dark ink on this zone ~${ratio.toFixed(1)}:1`,
  )
}
