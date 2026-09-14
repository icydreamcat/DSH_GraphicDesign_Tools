/**
 * Locate and measure the subject inside a full illustration.
 *
 * The design brief needs three numbers that cannot be eyeballed from a
 * thumbnail: the subject's bounding box in source pixels, the y at which the
 * subject stops being the darkest thing on the page, and the dominant palette
 * with its shares. Everything here is read from pixels and printed as numbers.
 *
 * Method: column/row ink profiles. For each column take the fraction of pixels
 * whose luminance is below `--dark` (default 0.34); the subject is the run of
 * columns where that fraction is sustained. Same for rows. Border-connected
 * bright regions are reported separately so the "air" above the head is known
 * rather than guessed.
 *
 * Usage: node tools/subject-probe.mjs <image> [--dark 0.34] [--quant 4]
 */

import { createCanvas, loadImage } from '@napi-rs/canvas'
import { readFileSync } from 'node:fs'
import { resolve, isAbsolute } from 'node:path'

const args = process.argv.slice(2)
const input = args[0]
if (input === undefined) {
  console.error('usage: node tools/subject-probe.mjs <image> [--dark 0.34] [--quant 4]')
  process.exit(1)
}
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback
}
const darkThreshold = opt('dark', 0.34)
const quant = opt('quant', 4)

const path = isAbsolute(input) ? input : resolve(process.cwd(), input)
const img = await loadImage(readFileSync(path))
const W = img.width
const H = img.height
const canvas = createCanvas(W, H)
const ctx = canvas.getContext('2d')
ctx.drawImage(img, 0, 0)
const { data } = ctx.getImageData(0, 0, W, H)

const lum = new Float32Array(W * H)
for (let i = 0, p = 0; i < W * H; i++, p += 4) {
  lum[i] = (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) / 255
}

const colFrac = new Float32Array(W)
const rowFrac = new Float32Array(H)
let darkPixels = 0
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (lum[y * W + x] < darkThreshold) {
      colFrac[x]++
      rowFrac[y]++
      darkPixels++
    }
  }
}
for (let x = 0; x < W; x++) colFrac[x] /= H
for (let y = 0; y < H; y++) rowFrac[y] /= W

/** Longest run of indices where value >= threshold. */
const longestRun = (arr, threshold) => {
  let best = null
  let start = -1
  for (let i = 0; i <= arr.length; i++) {
    const on = i < arr.length && arr[i] >= threshold
    if (on && start < 0) start = i
    if (!on && start >= 0) {
      if (best === null || i - start > best[1] - best[0]) best = [start, i - 1]
      start = -1
    }
  }
  return best
}

// The subject's columns: where dark ink is sustained. A low threshold because
// the figure's hair and skirt are mid-dark, not black.
const colRun = longestRun(colFrac, 0.02)
const rowRun = longestRun(rowFrac, 0.02)

// Per-band luminance, 12 horizontal bands — the tonal arc.
const bands = 12
const bandLum = []
for (let b = 0; b < bands; b++) {
  const y0 = Math.floor((H * b) / bands)
  const y1 = Math.floor((H * (b + 1)) / bands)
  let sum = 0
  let n = 0
  for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) { sum += lum[y * W + x]; n++ }
  bandLum.push(Math.round((sum / n) * 1000) / 1000)
}

// Vertical thirds, for the same reading left to right.
const vbands = 6
const vbandLum = []
for (let b = 0; b < vbands; b++) {
  const x0 = Math.floor((W * b) / vbands)
  const x1 = Math.floor((W * (b + 1)) / vbands)
  let sum = 0
  let n = 0
  for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) { sum += lum[y * W + x]; n++ }
  vbandLum.push(Math.round((sum / n) * 1000) / 1000)
}

// Quantised palette shares, 4 bits per channel by default.
const step = 256 / (1 << quant)
const counts = new Map()
for (let i = 0, p = 0; i < W * H; i++, p += 4) {
  const r = Math.min(255, Math.round(data[p] / step) * step)
  const g = Math.min(255, Math.round(data[p + 1] / step) * step)
  const b = Math.min(255, Math.round(data[p + 2] / step) * step)
  const key = (r << 16) | (g << 8) | b
  counts.set(key, (counts.get(key) || 0) + 1)
}
const total = W * H
const palette = [...counts.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 16)
  .map(([key, n]) => ({
    hex: '#' + key.toString(16).padStart(6, '0').toUpperCase(),
    share: Math.round((n / total) * 10000) / 10000,
  }))

// Saturation share and hue clusters: which families actually occupy the page.
let satSum = 0
let satHigh = 0
const hueHist = new Array(36).fill(0)
let hueCount = 0
for (let i = 0, p = 0; i < W * H; i++, p += 4) {
  const r = data[p] / 255
  const g = data[p + 1] / 255
  const b = data[p + 2] / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const s = max === 0 ? 0 : (max - min) / max
  satSum += s
  if (s > 0.35) satHigh++
  if (s > 0.15 && max > 0.08) {
    let h
    if (max === r) h = ((g - b) / (max - min)) % 6
    else if (max === g) h = (b - r) / (max - min) + 2
    else h = (r - g) / (max - min) + 4
    h = ((h * 60) + 360) % 360
    hueHist[Math.floor(h / 10)]++
    hueCount++
  }
}
const hueClusters = hueHist
  .map((n, i) => ({ hue: i * 10, share: hueCount === 0 ? 0 : Math.round((n / hueCount) * 1000) / 1000 }))
  .filter((h) => h.share > 0.03)
  .sort((a, b) => b.share - a.share)

console.log(JSON.stringify({
  ok: true,
  input: path,
  size: { width: W, height: H },
  aspect: Math.round((W / H) * 1000) / 1000,
  darkThreshold,
  darkShare: Math.round((darkPixels / total) * 10000) / 10000,
  subjectColumns: colRun === null ? null : {
    from: colRun[0], to: colRun[1],
    x0: Math.round((colRun[0] / W) * 1000) / 1000,
    x1: Math.round((colRun[1] / W) * 1000) / 1000,
    widthShare: Math.round(((colRun[1] - colRun[0]) / W) * 1000) / 1000,
  },
  subjectRows: rowRun === null ? null : {
    from: rowRun[0], to: rowRun[1],
    y0: Math.round((rowRun[0] / H) * 1000) / 1000,
    y1: Math.round((rowRun[1] / H) * 1000) / 1000,
    heightShare: Math.round(((rowRun[1] - rowRun[0]) / H) * 1000) / 1000,
  },
  bandLuminance: bandLum,
  vbandLuminance: vbandLum,
  meanLuminance: Math.round((lum.reduce((a, b) => a + b, 0) / total) * 1000) / 1000,
  meanSaturation: Math.round((satSum / total) * 1000) / 1000,
  saturatedShare: Math.round((satHigh / total) * 10000) / 10000,
  hueClusters,
  palette,
}, null, 2))
