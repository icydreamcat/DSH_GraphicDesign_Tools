/**
 * alpha-probe — measure what the supplied "立绘" actually contains.
 *
 * The question this answers is a design question, not a curiosity: if the
 * ground is a real opaque white backdrop baked into the pixels, then a poster
 * with a light ground cannot be built by simply placing the file — the white
 * coat would dissolve into the paper and the figure would lose its silhouette.
 * If instead the alpha channel already carries the cutout, the file is a
 * transparent PNG and the ground is mine to choose.
 *
 * So: report the alpha distribution, the tone distribution of the opaque
 * pixels, and the bounding box of everything that is not the ground colour.
 * Numbers first, decision after.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const SRC = process.argv[2]
const OUT = process.argv[3]

const img = await loadImage(readFileSync(SRC))
const W = img.width, H = img.height
const cv = createCanvas(W, H)
const ctx = cv.getContext('2d')
ctx.drawImage(img, 0, 0)
const d = ctx.getImageData(0, 0, W, H).data

let opaque = 0, transparent = 0, partial = 0
const alphaHist = new Array(16).fill(0)
for (let i = 0; i < W * H; i++) {
  const a = d[i * 4 + 3]
  alphaHist[a >> 4]++
  if (a === 255) opaque++
  else if (a === 0) transparent++
  else partial++
}

// Corner colour: the modal colour of the four 40px corner blocks. This is the
// best available estimate of "the backdrop as drawn".
const corners = []
const grab = (x0, y0) => {
  for (let y = y0; y < y0 + 40; y++) for (let x = x0; x < x0 + 40; x++) {
    const o = (y * W + x) * 4
    corners.push([d[o], d[o + 1], d[o + 2], d[o + 3]])
  }
}
grab(0, 0); grab(W - 40, 0); grab(0, H - 40); grab(W - 40, H - 40)
const avg = corners.reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2], a[3] + c[3]], [0, 0, 0, 0]).map(v => v / corners.length)
const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')

// Treat a pixel as "ink" when it differs from the corner colour by more than a
// threshold — this is what the figure's bounding box must be measured against.
const TH = 12
let minX = W, minY = H, maxX = -1, maxY = -1, ink = 0
const rowInk = new Array(H).fill(0)
const colInk = new Array(W).fill(0)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4
    const diff = Math.abs(d[o] - avg[0]) + Math.abs(d[o + 1] - avg[1]) + Math.abs(d[o + 2] - avg[2])
    const isInk = d[o + 3] > 8 && (diff > TH || d[o + 3] < 250)
    if (isInk) {
      ink++
      rowInk[y]++; colInk[x]++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
}

// Where the ink actually is: report the first and last row/column carrying more
// than 0.3% of the width/height of ink, so a stray antialiased pixel cannot
// define the box.
const rowTh = W * 0.003, colTh = H * 0.003
const rows = rowInk.map((v, i) => [i, v]).filter(([, v]) => v > rowTh)
const cols = colInk.map((v, i) => [i, v]).filter(([, v]) => v > colTh)

// Tone histogram of ink pixels only.
const toneHist = new Array(10).fill(0)
for (let i = 0; i < W * H; i++) {
  const o = i * 4
  if (d[o + 3] < 250) continue
  const diff = Math.abs(d[o] - avg[0]) + Math.abs(d[o + 1] - avg[1]) + Math.abs(d[o + 2] - avg[2])
  if (diff <= TH) continue
  const lum = (0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) / 255
  toneHist[Math.min(9, Math.floor(lum * 10))]++
}

const report = {
  ok: true,
  source: SRC,
  size: `${W}x${H}`,
  alpha: {
    opaque, transparent, partial,
    opaqueShare: +(opaque / (W * H)).toFixed(4),
    transparentShare: +(transparent / (W * H)).toFixed(4),
    partialShare: +(partial / (W * H)).toFixed(4),
    histogram16: alphaHist,
  },
  cornerGround: { rgb: avg.map(v => Math.round(v)), hex: hex(...avg) },
  ink: {
    pixels: ink,
    share: +(ink / (W * H)).toFixed(4),
    bboxDiffThreshold: { minX, minY, maxX, maxY },
    bboxFraction: {
      x: +(minX / W).toFixed(4), y: +(minY / H).toFixed(4),
      w: +((maxX - minX + 1) / W).toFixed(4), h: +((maxY - minY + 1) / H).toFixed(4),
    },
    bboxRobust: {
      minY: rows.length ? rows[0][0] : null,
      maxY: rows.length ? rows[rows.length - 1][0] : null,
      minX: cols.length ? cols[0][0] : null,
      maxX: cols.length ? cols[cols.length - 1][0] : null,
    },
    bboxRobustFraction: rows.length && cols.length ? {
      x: +(cols[0][0] / W).toFixed(4),
      y: +(rows[0][0] / H).toFixed(4),
      w: +((cols[cols.length - 1][0] - cols[0][0] + 1) / W).toFixed(4),
      h: +((rows[rows.length - 1][0] - rows[0][0] + 1) / H).toFixed(4),
    } : null,
  },
  inkToneDeciles: toneHist,
}

if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
