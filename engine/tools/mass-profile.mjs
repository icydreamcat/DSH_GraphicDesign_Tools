/**
 * mass-profile — where the figure's ink actually is, so type can be placed
 * against measurements instead of against a guess.
 *
 * The design question: the portrait's type is going to occupy one region at
 * full strength, and I need to know which regions of the canvas the subject
 * leaves empty — not approximately, but per cell. This returns a coarse
 * occupancy grid plus row/column mass profiles from the alpha channel.
 *
 * Alpha, not colour: the supplied file is a transparent cutout (measured:
 * 30% opaque, 64% fully transparent), so alpha IS the silhouette. Using
 * luminance would confuse the white coat with the empty ground.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const SRC = process.argv[2]
const COLS = Number(process.argv[3] ?? 12)
const ROWS = Number(process.argv[4] ?? 16)
const OUT = process.argv[5]

const img = await loadImage(readFileSync(SRC))
const W = img.width, H = img.height
const cv = createCanvas(W, H)
const ctx = cv.getContext('2d')
ctx.drawImage(img, 0, 0)
const d = ctx.getImageData(0, 0, W, H).data

const alphaAt = (x, y) => d[(y * W + x) * 4 + 3]

// Row and column mass: how much ink each line carries, relative to the widest.
const rowMass = new Array(H).fill(0)
const colMass = new Array(W).fill(0)
for (let y = 0; y < H; y++) {
  let s = 0
  for (let x = 0; x < W; x++) s += alphaAt(x, y) / 255
  rowMass[y] = s
}
for (let x = 0; x < W; x++) {
  let s = 0
  for (let y = 0; y < H; y++) s += alphaAt(x, y) / 255
  colMass[x] = s
}
const rowMax = Math.max(...rowMass), colMax = Math.max(...colMass)

// Left and right extent of ink per row band — this is the field that decides
// where a type block can sit without landing on the subject.
const bands = []
for (let r = 0; r < ROWS; r++) {
  const y0 = Math.floor((r * H) / ROWS), y1 = Math.floor(((r + 1) * H) / ROWS)
  let minX = W, maxX = -1, mass = 0, cells = 0
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < W; x++) {
      const a = alphaAt(x, y)
      if (a > 24) { if (x < minX) minX = x; if (x > maxX) maxX = x; mass += a / 255; cells++ }
    }
  }
  const cellsRow = []
  for (let c = 0; c < COLS; c++) {
    const x0 = Math.floor((c * W) / COLS), x1 = Math.floor(((c + 1) * W) / COLS)
    let s = 0, n = 0
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const a = alphaAt(x, y)
      if (a > 24) { s += a / 255; n++ }
    }
    cellsRow.push(+((n / ((y1 - y0) * (x1 - x0)))).toFixed(3))
  }
  bands.push({
    band: r,
    yFrac: +(y0 / H).toFixed(4),
    yFracEnd: +(y1 / H).toFixed(4),
    inkShareOfColumns: minX === W ? 0 : +((maxX - minX + 1) / W).toFixed(4),
    inkFromX: minX === W ? null : +(minX / W).toFixed(4),
    inkToX: maxX < 0 ? null : +((maxX + 1) / W).toFixed(4),
    fill: +((mass / (W * (y1 - y0)))).toFixed(4),
    occupancy: cellsRow,
  })
}

// Same, transposed: for each column band, the vertical extent of ink. Needed to
// know how far down a right-hand text column can run before it meets the hem.
const colBands = []
for (let c = 0; c < COLS; c++) {
  const x0 = Math.floor((c * W) / COLS), x1 = Math.floor(((c + 1) * W) / COLS)
  let minY = H, maxY = -1
  for (let x = x0; x < x1; x++) {
    for (let y = 0; y < H; y++) {
      if (alphaAt(x, y) > 24) { if (y < minY) minY = y; if (y > maxY) maxY = y }
    }
  }
  colBands.push({
    col: c,
    xFrac: +(x0 / W).toFixed(4),
    xFracEnd: +(x1 / W).toFixed(4),
    inkFromY: minY === H ? null : +(minY / H).toFixed(4),
    inkToY: maxY < 0 ? null : +((maxY + 1) / H).toFixed(4),
  })
}

const report = {
  ok: true, source: SRC, size: `${W}x${H}`,
  opaqueShare: +(rowMass.reduce((a, b) => a + b, 0) / (W * H)).toFixed(4),
  bands, colBands,
  rowMassSample: Array.from({ length: 20 }, (_, i) => {
    const y = Math.floor((i / 19) * (H - 1))
    return { yFrac: +(y / H).toFixed(3), relMass: +(rowMass[y] / rowMax).toFixed(3) }
  }),
  colMassSample: Array.from({ length: 20 }, (_, i) => {
    const x = Math.floor((i / 19) * (W - 1))
    return { xFrac: +(x / W).toFixed(3), relMass: +(colMass[x] / colMax).toFixed(3) }
  }),
}
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2))

// Compact console form — the occupancy grid is what I actually read.
console.log(report.size, 'opaqueShare', report.opaqueShare)
console.log('OCCUPANCY (rows x cols, 0.00-1.00 = fraction of cell inked)')
for (const b of bands) {
  console.log(
    b.yFrac.toFixed(3).padStart(5),
    b.occupancy.map(v => v.toFixed(2).padStart(5)).join(''),
    ' | x', String(b.inkFromX).padStart(5), '→', String(b.inkToX).padStart(5),
  )
}
console.log('COLUMN EXTENT')
for (const c of colBands) {
  console.log(c.xFrac.toFixed(3).padStart(5), '→', c.xFracEnd.toFixed(3).padStart(5),
    ' y', String(c.inkFromY).padStart(5), '→', String(c.inkToY).padStart(5))
}
