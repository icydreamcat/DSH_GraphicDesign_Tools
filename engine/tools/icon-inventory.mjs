/**
 * Inventory an icon pack: what is actually in those PNGs.
 *
 * Placing icons into a poster needs three numbers the filenames do not carry:
 * the pixel size (a 128px icon and a 2000px icon need completely different
 * treatment), the ALPHA MODE (a white-on-transparent glyph behaves differently
 * from a black mark on an opaque white square), and the ink coverage (how much
 * of the box the mark occupies, which decides the display size that makes a set
 * of icons look like one family).
 *
 * `--sheet` writes a contact sheet: every icon in one grid, normalised to a
 * common cell and shown on mid grey with a light chip behind it, so one look
 * answers "what shapes are these and do they read as a family" — which no table
 * of numbers can.
 *
 * Usage: node tools/icon-inventory.mjs <dir> [--max 60] [--csv out.csv] [--sheet out.png]
 */

import { createCanvas, loadImage } from '@napi-rs/canvas'
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { join, extname, resolve, isAbsolute, basename } from 'node:path'

const args = process.argv.slice(2)
const root = args[0]
if (root === undefined) {
  console.error('usage: node tools/icon-inventory.mjs <dir> [--max 60] [--csv out.csv]')
  process.exit(1)
}
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}
const maxPrint = Number(opt('max', 60))
const csvPath = opt('csv', null)
const sheetPath = opt('sheet', null)

const rootAbs = isAbsolute(root) ? root : resolve(process.cwd(), root)

/** Walk a directory, collecting image files. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (['.png', '.webp', '.jpg', '.jpeg'].includes(extname(name).toLowerCase())) out.push(full)
  }
  return out
}

const files = walk(rootAbs).sort()
const rows = []

for (const file of files) {
  let img
  try {
    img = await loadImage(readFileSync(file))
  } catch (err) {
    rows.push({ name: basename(file), error: String(err.message).slice(0, 60) })
    continue
  }
  const W = img.width
  const H = img.height
  const cv = createCanvas(W, H)
  const ctx = cv.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const { data } = ctx.getImageData(0, 0, W, H)

  let alphaMin = 255
  let alphaMax = 0
  let transparent = 0
  let inkPixels = 0
  // Luminance of the ink only (alpha > 8), so a transparent PNG reports the
  // colour of its MARK rather than averaging in the empty corners.
  let inkSum = 0
  let minX = W
  let minY = H
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4
      const a = data[p + 3]
      if (a < alphaMin) alphaMin = a
      if (a > alphaMax) alphaMax = a
      if (a < 8) { transparent++; continue }
      const lum = (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) / 255
      inkSum += lum
      inkPixels++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  const total = W * H
  const inkShare = inkPixels / total
  const meanInkLum = inkPixels === 0 ? null : Math.round((inkSum / inkPixels) * 1000) / 1000
  const alphaMode = alphaMin === 255
    ? 'opaque'
    : alphaMax === 0
      ? 'empty'
      : transparent / total > 0.5 ? 'cutout' : 'partial'

  rows.push({
    name: basename(file),
    w: W,
    h: H,
    ratio: Math.round((W / H) * 100) / 100,
    alphaMode,
    inkShare: Math.round(inkShare * 1000) / 1000,
    meanInkLum,
    // The tight box of the mark inside the file: an icon with huge padding
    // cannot be sized by its file dimensions alone.
    inkBox: maxX < 0 ? null : { x0: minX, y0: minY, x1: maxX, y1: maxY },
    paddingShare: maxX < 0 ? null : Math.round((1 - ((maxX - minX + 1) * (maxY - minY + 1)) / total) * 1000) / 1000,
  })
}

// Summarise by directory, because a pack's CONSISTENCY is what makes a set of
// icons usable as one graphic layer.
const byDir = new Map()
for (const r of rows) {
  if (r.error !== undefined) continue
  const dir = basename(resolve(r.name, '..')) // placeholder, replaced below
  void dir
}
for (const file of files) {
  const rel = file.slice(rootAbs.length + 1)
  const dir = rel.includes('\\') ? rel.slice(0, rel.lastIndexOf('\\')) : '.'
  if (!byDir.has(dir)) byDir.set(dir, [])
  byDir.get(dir).push(basename(file))
}

const summary = [...byDir.entries()].map(([dir, names]) => {
  const set = rows.filter((r) => names.includes(r.name) && r.error === undefined)
  const sizes = set.map((r) => r.w)
  const lums = set.map((r) => r.meanInkLum).filter((v) => v !== null)
  return {
    dir,
    count: names.length,
    sizeMin: sizes.length === 0 ? null : Math.min(...sizes),
    sizeMax: sizes.length === 0 ? null : Math.max(...sizes),
    alphaModes: [...new Set(set.map((r) => r.alphaMode))],
    meanInkLumMin: lums.length === 0 ? null : Math.min(...lums),
    meanInkLumMax: lums.length === 0 ? null : Math.max(...lums),
  }
})

console.log(JSON.stringify({
  ok: true,
  root: rootAbs,
  fileCount: files.length,
  summary,
  sheet: sheetPath,
  icons: rows.slice(0, maxPrint),
}, null, 2))

if (csvPath !== null) {
  const header = 'name,w,h,ratio,alphaMode,inkShare,meanInkLum,padShare\n'
  const body = rows.filter((r) => r.error === undefined)
    .map((r) => [r.name, r.w, r.h, r.ratio, r.alphaMode, r.inkShare, r.meanInkLum, r.paddingShare].join(','))
    .join('\n')
  writeFileSync(resolve(process.cwd(), csvPath), header + body)
  console.error(`csv: ${csvPath}`)
}

if (sheetPath !== null) {
  const ok = rows.filter((r) => r.error === undefined)
  const CELL = 190
  const GAP = 26
  const LABEL = 22
  const COLS = Math.min(8, Math.max(1, Math.ceil(Math.sqrt(ok.length))))
  const ROWS = Math.ceil(ok.length / COLS)
  const SW = COLS * (CELL + GAP) + GAP
  const SH = ROWS * (CELL + LABEL + GAP) + GAP
  const sheet = createCanvas(SW, SH)
  const sc = sheet.getContext('2d')
  // Mid grey ground so BOTH a black mark and a white mark are visible against
  // it; a white contact sheet would hide half of these packs.
  sc.fillStyle = '#8f8f8f'
  sc.fillRect(0, 0, SW, SH)

  for (const [i, row] of ok.entries()) {
    const col = i % COLS
    const line = Math.floor(i / COLS)
    const cx = GAP + col * (CELL + GAP)
    const cy = GAP + line * (CELL + LABEL + GAP)
    // A light chip behind each cell, because most of these packs are
    // black-on-transparent and would vanish into the grey alone.
    sc.fillStyle = '#f2f2ef'
    sc.fillRect(cx, cy, CELL, CELL)
    const file = files.find((f) => basename(f) === row.name)
    if (file !== undefined) {
      try {
        const img = await loadImage(readFileSync(file))
        // Normalise to the cell's inner box so the SHEET compares shapes rather
        // than comparing source resolutions.
        const inner = CELL - 24
        const s = Math.min(inner / img.width, inner / img.height)
        const dw = img.width * s
        const dh = img.height * s
        sc.imageSmoothingEnabled = true
        sc.imageSmoothingQuality = 'high'
        sc.drawImage(img, cx + (CELL - dw) / 2, cy + (CELL - dh) / 2, dw, dh)
      } catch { /* reported in the table */ }
    }
    sc.fillStyle = '#1b1b1b'
    sc.font = '13px monospace'
    sc.fillText(`${row.name}  ${row.w}x${row.h}`, cx, cy + CELL + 15)
  }

  writeFileSync(resolve(process.cwd(), sheetPath), sheet.toBuffer('image/png'))
  console.error(`sheet: ${sheetPath}  (${SW}x${SH}, ${ok.length} icons)`)
}
