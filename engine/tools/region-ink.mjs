/**
 * region-ink — how much of a rectangle of the source is actually inked.
 *
 * Answers placement questions that looking cannot settle: is the right margin
 * empty enough for a vertical column of type, and how far in does the raised
 * hand reach at that height? Reads alpha, because the supplied file is a
 * transparent cutout and alpha IS the silhouette.
 *
 * Usage: node tools/region-ink.mjs <png> <x0> <y0> <x1> <y1> [cols] [rows]
 *        coordinates are fractions of the canvas.
 */
import { readFileSync } from 'node:fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const [, , SRC, x0f, y0f, x1f, y1f, colsArg, rowsArg] = process.argv
const cols = Number(colsArg ?? 8), rows = Number(rowsArg ?? 8)

const img = await loadImage(readFileSync(SRC))
const W = img.width, H = img.height
const cv = createCanvas(W, H)
const ctx = cv.getContext('2d')
ctx.drawImage(img, 0, 0)
const d = ctx.getImageData(0, 0, W, H).data

const X0 = Math.round(Number(x0f) * W), X1 = Math.round(Number(x1f) * W)
const Y0 = Math.round(Number(y0f) * H), Y1 = Math.round(Number(y1f) * H)

console.log(`${SRC} ${W}x${H}  region x ${X0}-${X1} y ${Y0}-${Y1}`)
console.log('occupancy per cell (fraction of cell inked at alpha>24):')

// Per-column ink within the region, which is what decides whether a vertical
// line of type at a given x will collide with anything.
const colInk = [], rowInk = []
for (let x = X0; x < X1; x++) {
  let n = 0
  for (let y = Y0; y < Y1; y++) if (d[(y * W + x) * 4 + 3] > 24) n++
  colInk.push(n / (Y1 - Y0))
}
for (let y = Y0; y < Y1; y++) {
  let n = 0
  for (let x = X0; x < X1; x++) if (d[(y * W + x) * 4 + 3] > 24) n++
  rowInk.push(n / (X1 - X0))
}

for (let r = 0; r < rows; r++) {
  const ya = Y0 + Math.floor((r * (Y1 - Y0)) / rows), yb = Y0 + Math.floor(((r + 1) * (Y1 - Y0)) / rows)
  const cells = []
  for (let c = 0; c < cols; c++) {
    const xa = X0 + Math.floor((c * (X1 - X0)) / cols), xb = X0 + Math.floor(((c + 1) * (X1 - X0)) / cols)
    let n = 0
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) if (d[(y * W + x) * 4 + 3] > 24) n++
    cells.push((n / ((yb - ya) * (xb - xa))).toFixed(2).padStart(5))
  }
  console.log(`y ${(ya / H).toFixed(3)}`, cells.join(''))
}

const max = Math.max(...colInk)
console.log(`\npeak per-column ink ${max.toFixed(3)} at x=${(((colInk.indexOf(max) + X0) / W)).toFixed(4)}`)
const clean = colInk.map((v, i) => [i + X0, v]).filter(([, v]) => v < 0.01).map(([x]) => x)
console.log('columns with <1% ink:', clean.length ? `${clean[0]}-${clean[clean.length - 1]} of ${W} (${(clean[0] / W).toFixed(3)}-${((clean[clean.length - 1]) / W).toFixed(3)})` : 'none')
