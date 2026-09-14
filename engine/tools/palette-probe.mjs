/**
 * palette-probe — report the dominant colours of a reference and where its
 * tone sits per band.
 *
 * `design_analyze` gives a specification, but two things it does not give are
 * the ones this rework needs: the actual dominant FILL colours (so a palette can
 * be taken from a reference rather than invented), and the mean tone of each
 * horizontal band (so a "dark at the top, light at the bottom" arc can be
 * verified as a number rather than asserted from looking).
 *
 * Usage: node tools/palette-probe.mjs <image> [bands] [bins]
 */
import { readFileSync } from 'node:fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const [, , SRC, bandsArg, binsArg] = process.argv
const BANDS = Number(bandsArg ?? 10)
const BINS = Number(binsArg ?? 5)

const img = await loadImage(readFileSync(SRC))
const W = img.width, H = img.height
const cv = createCanvas(W, H)
const ctx = cv.getContext('2d')
ctx.drawImage(img, 0, 0)
const d = ctx.getImageData(0, 0, W, H).data

const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')

// Quantise to a coarse lattice and count — dominant FILL colours, not averages.
const counts = new Map()
const step = 16
for (let i = 0; i < W * H; i++) {
  const o = i * 4
  if (d[o + 3] < 8) continue
  const key = `${d[o] >> 4},${d[o + 1] >> 4},${d[o + 2] >> 4}`
  let e = counts.get(key)
  if (e === undefined) { e = { n: 0, r: 0, g: 0, b: 0 }; counts.set(key, e) }
  e.n++; e.r += d[o]; e.g += d[o + 1]; e.b += d[o + 2]
}
const total = W * H
const top = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 14)
console.log(`${SRC}  ${W}x${H}`)
console.log('\n--- dominant colours (coarse 4-bit lattice, mean of each cell) ---')
for (const e of top) {
  const r = e.r / e.n, g = e.g / e.n, b = e.b / e.n
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  const sat = mx === 0 ? 0 : (mx - mn) / mx
  console.log(`  ${hex(r, g, b)}  ${(e.n / total * 100).toFixed(2).padStart(5)}%  L=${lum(r, g, b).toFixed(3)}  S=${sat.toFixed(2)}`)
}

console.log('\n--- tone per horizontal band (top to bottom) ---')
const rows = []
for (let bIdx = 0; bIdx < BANDS; bIdx++) {
  const y0 = Math.floor((bIdx * H) / BANDS), y1 = Math.floor(((bIdx + 1) * H) / BANDS)
  let s = 0, n = 0, sat = 0
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4
      const L = lum(d[o], d[o + 1], d[o + 2])
      const mx = Math.max(d[o], d[o + 1], d[o + 2]), mn = Math.min(d[o], d[o + 1], d[o + 2])
      s += L; sat += mx === 0 ? 0 : (mx - mn) / mx; n++
    }
  }
  const mean = s / n
  rows.push({ band: bIdx, y: (y0 / H).toFixed(2), meanLuma: +mean.toFixed(3), meanSat: +(sat / n).toFixed(3) })
}
for (const r of rows) {
  const bar = '#'.repeat(Math.round(r.meanLuma * 40))
  console.log(`  band ${String(r.band).padStart(2)}  y>${r.y}  L=${r.meanLuma.toFixed(3)}  S=${r.meanSat.toFixed(3)}  ${bar}`)
}
const first = rows[0].meanLuma, last = rows[rows.length - 1].meanLuma
console.log(`\narc: top ${first.toFixed(3)} -> bottom ${last.toFixed(3)}  (delta ${(last - first).toFixed(3)})`)
console.log(`monotonic increase top-to-bottom: ${rows.every((r, i) => i === 0 || r.meanLuma >= rows[i - 1].meanLuma - 0.02)}`)

console.log('\n--- tone per vertical band (left to right) ---')
for (let bIdx = 0; bIdx < BINS; bIdx++) {
  const x0 = Math.floor((bIdx * W) / BINS), x1 = Math.floor(((bIdx + 1) * W) / BINS)
  let s = 0, n = 0
  for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) {
    const o = (y * W + x) * 4
    s += lum(d[o], d[o + 1], d[o + 2]); n++
  }
  console.log(`  col ${bIdx}  x>${(x0 / W).toFixed(2)}  L=${(s / n).toFixed(3)}`)
}
