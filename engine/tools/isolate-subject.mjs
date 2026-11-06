/**
 * isolate-subject — separate the figure from the decorations that float free of
 * it, and report the geometry that decides the page.
 *
 * Why this is needed rather than "just place the PNG": the supplied file
 * contains, besides the figure, a population of soap bubbles and a few loose
 * ribbons scattered around her. Every one of them is ink, and ink is what a
 * type block collides with. They also carry the design: the bubbles are the
 * operator's whole fiction — her talent is a bubble that shields a friendly
 * unit — so they are not noise to be deleted, they are material to be arranged.
 *
 * So the tool does two things:
 *   1. labels the alpha mask into connected components and reports each one's
 *      box, area and mean tone, largest first (deterministic 8-connected
 *      flood fill, no library);
 *   2. writes a new PNG keeping only components at or above a size threshold —
 *      the figure and the staff — so the empty column the type needs is really
 *      empty, not merely quiet.
 *
 * The threshold is deliberately a parameter with no clever default: which
 * bubbles belong to the composition is a design decision, and this tool's job
 * is to make the two options measurable, not to make the choice.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const SRC = process.argv[2]
const OUT_PNG = process.argv[3]
const OUT_JSON = process.argv[4]
const MIN_AREA = Number(process.argv[5] ?? 1200)   // px, at source resolution

const img = await loadImage(readFileSync(SRC))
const W = img.width, H = img.height
const cv = createCanvas(W, H)
const ctx = cv.getContext('2d')
ctx.drawImage(img, 0, 0)
const id = ctx.getImageData(0, 0, W, H)
const d = id.data

const A = new Uint8Array(W * H)
for (let i = 0; i < W * H; i++) A[i] = d[i * 4 + 3] > 24 ? 1 : 0

// Iterative 8-connected labelling (an explicit stack — recursion would blow up
// on a 500k-pixel component).
const label = new Int32Array(W * H).fill(-1)
const comps = []
const stack = new Int32Array(W * H)
for (let s = 0; s < W * H; s++) {
  if (A[s] === 0 || label[s] !== -1) continue
  const id0 = comps.length
  let sp = 0
  stack[sp++] = s
  label[s] = id0
  let area = 0, minX = W, maxX = -1, minY = H, maxY = -1, sumLum = 0
  while (sp > 0) {
    const p = stack[--sp]
    const x = p % W, y = (p / W) | 0
    area++
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    const o = p * 4
    sumLum += (0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) / 255
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy
      if (ny < 0 || ny >= H) continue
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx
        if (nx < 0 || nx >= W) continue
        const q = ny * W + nx
        if (A[q] === 1 && label[q] === -1) { label[q] = id0; stack[sp++] = q }
      }
    }
  }
  comps.push({
    id: id0, area, minX, minY, maxX, maxY,
    w: maxX - minX + 1, h: maxY - minY + 1,
    meanLum: +(sumLum / area).toFixed(3),
    cx: +(((minX + maxX) / 2) / W).toFixed(4),
    cy: +(((minY + maxY) / 2) / H).toFixed(4),
    boxFrac: {
      x: +(minX / W).toFixed(4), y: +(minY / H).toFixed(4),
      w: +((maxX - minX + 1) / W).toFixed(4), h: +((maxY - minY + 1) / H).toFixed(4),
    },
  })
}
comps.sort((a, b) => b.area - a.area)

const kept = new Set(comps.filter(c => c.area >= MIN_AREA).map(c => c.id))
let keptPx = 0
for (let i = 0; i < W * H; i++) {
  if (label[i] !== -1 && !kept.has(label[i])) { d[i * 4 + 3] = 0; keptPx++ }
}
ctx.putImageData(id, 0, 0)
if (OUT_PNG) writeFileSync(OUT_PNG, cv.toBuffer('image/png'))

// Bounding box of what survived, measured robustly: the first/last row and
// column carrying more than 0.3% of the axis.
const kRow = new Array(H).fill(0), kCol = new Array(W).fill(0)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x
  if (A[i] === 1 && kept.has(label[i])) { kRow[y]++; kCol[x]++ }
}
const rows = kRow.map((v, i) => [i, v]).filter(([, v]) => v > W * 0.003)
const cols = kCol.map((v, i) => [i, v]).filter(([, v]) => v > H * 0.003)
const keepBox = rows.length && cols.length ? {
  minY: rows[0][0], maxY: rows[rows.length - 1][0],
  minX: cols[0][0], maxX: cols[cols.length - 1][0],
} : null

const report = {
  ok: true, source: SRC, size: `${W}x${H}`, minArea: MIN_AREA,
  componentCount: comps.length,
  keptComponents: comps.filter(c => kept.has(c.id)).length,
  removedPixels: keptPx,
  components: comps.slice(0, 30),
  keptBBoxPx: keepBox,
  keptBBoxFraction: keepBox ? {
    x: +(keepBox.minX / W).toFixed(4), y: +(keepBox.minY / H).toFixed(4),
    w: +((keepBox.maxX - keepBox.minX + 1) / W).toFixed(4),
    h: +((keepBox.maxY - keepBox.minY + 1) / H).toFixed(4),
  } : null,
  contactSheetHint: 'components[0] is the figure; anything with area < minArea is a detached mark',
}
if (OUT_JSON) writeFileSync(OUT_JSON, JSON.stringify(report, null, 2))

console.log(`${W}x${H}  components=${comps.length}  kept=${report.keptComponents}  stripped=${keptPx}px`)
console.log('top components (area, box as fraction of canvas, mean luma):')
for (const c of comps.slice(0, 26)) {
  console.log(
    String(c.area).padStart(7),
    `x${c.boxFrac.x.toFixed(3)} y${c.boxFrac.y.toFixed(3)} w${c.boxFrac.w.toFixed(3)} h${c.boxFrac.h.toFixed(3)}`,
    `lum ${c.meanLum.toFixed(2)}`,
    c.area >= MIN_AREA ? 'KEEP' : '',
  )
}
if (keepBox) console.log('kept bbox px', JSON.stringify(keepBox), 'frac', JSON.stringify(report.keptBBoxFraction))
