/**
 * Set a specimen sheet of every registered face, using THIS page's own words.
 *
 * WHY A SPECIMEN RATHER THAN A LIST
 * ---------------------------------
 * The engine reports 31 faces with aliases, classes and axis ranges, and none of that says
 * what a face LOOKS like at the size and in the role this page needs. Choosing type from a
 * metadata table is guessing; the only way to judge a face is to set the actual string in
 * it and look.
 *
 * Each face is set twice:
 *   a display line at 84px, in the words the poster's display type uses
 *   a label line at 22px, tracked out, in the words its small type uses
 *
 * Faces whose files are missing are reported, not silently skipped — a specimen that
 * quietly omits a third of the catalogue is worse than no specimen.
 *
 * Usage: node tools/font-specimen.mjs [--out out/font-specimen.png] [--cols 3]
 */

import { createCanvas } from '@napi-rs/canvas'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { registerFonts, styleFor, hasFace, fontFamilyReport } from '../src/fonts.mjs'
import { parseFontSpec, measureLine, drawLine } from '../src/text.mjs'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}
const outPath = resolve(process.cwd(), opt('out', 'out/font-specimen.png'))
const COLS = Number(opt('cols', 3))

registerFonts()
const report = fontFamilyReport()
const faces = report.faces.filter((f) => f.available !== false)

// The page's own words, so the specimen answers the question actually being asked.
const DISPLAY = 'GINKGO 缪尔赛思'
const LABEL = 'BEYOND THE SEASONS · 时序之外'
const BODY = 'The leaf falls, the water remembers.'

const CELL_W = 620
const CELL_H = 210
const PAD = 26
const ROWS = Math.ceil(faces.length / COLS)
const W = COLS * CELL_W + PAD
const H = ROWS * CELL_H + PAD

const cv = createCanvas(W, H)
const c = cv.getContext('2d')
c.fillStyle = '#FBFBF6'
c.fillRect(0, 0, W, H)

const results = []
const skipped = []

for (const [i, f] of faces.entries()) {
  const col = i % COLS
  const row = Math.floor(i / COLS)
  const x0 = PAD + col * CELL_W
  const y0 = PAD + row * CELL_H

  c.strokeStyle = '#DCDEC6'
  c.lineWidth = 1
  c.strokeRect(x0 + 0.5, y0 + 0.5, CELL_W - PAD, CELL_H - PAD)

  if (!hasFace(f.alias)) { skipped.push(f.alias); continue }

  const ink = '#4E5427'
  try {
    // Display line.
    const dSpec = parseFontSpec({ family: [f.alias], size: 84, tracking: -0.01 }, 84)
    const dStyle = styleFor(dSpec.stack[0], dSpec.spec)
    c.font = dStyle.font
    if (dStyle.variationSettings !== '') c.fontVariationSettings = dStyle.variationSettings
    const dLine = measureLine(c, DISPLAY, dSpec.stack, dSpec.spec, dSpec.trackingEm)
    const dWidth = Math.round(dLine.width)
    drawLine(c, { text: DISPLAY, ...dLine }, dSpec.stack, dSpec.spec, dSpec.trackingEm, x0 + 16, y0 + 96, CELL_W - PAD - 32, 'left', ink)

    // Label line, tracked out the way the page's small type is.
    const lSpec = parseFontSpec({ family: [f.alias], size: 21, tracking: 0.26 }, 21)
    const lStyle = styleFor(lSpec.stack[0], lSpec.spec)
    c.font = lStyle.font
    if (lStyle.variationSettings !== '') c.fontVariationSettings = lStyle.variationSettings
    const lLine = measureLine(c, LABEL, lSpec.stack, lSpec.spec, lSpec.trackingEm)
    drawLine(c, { text: LABEL, ...lLine }, lSpec.stack, lSpec.spec, lSpec.trackingEm, x0 + 16, y0 + 140, CELL_W - PAD - 32, 'left', ink)

    // Body line, to judge text sizes rather than only headlines.
    const bSpec = parseFontSpec({ family: [f.alias], size: 26, tracking: 0 }, 26)
    const bStyle = styleFor(bSpec.stack[0], bSpec.spec)
    c.font = bStyle.font
    if (bStyle.variationSettings !== '') c.fontVariationSettings = bStyle.variationSettings
    const bLine = measureLine(c, BODY, bSpec.stack, bSpec.spec, bSpec.trackingEm)
    drawLine(c, { text: BODY, ...bLine }, bSpec.stack, bSpec.spec, bSpec.trackingEm, x0 + 16, y0 + 176, CELL_W - PAD - 32, 'left', '#6E7439')

    // The label, set at the cell's foot.
    c.font = '11px monospace'
    c.fillStyle = '#8A8D80'
    c.fillText(`${f.alias} · ${f.class} · ${f.variable ? 'variable' : 'static'}`, x0 + 16, y0 + CELL_H - PAD - 8)

    results.push({
      alias: f.alias,
      label: f.label,
      class: f.class,
      variable: f.variable,
      // Widths at the specimen's own sizes, which is what tells a display face from a
      // text face: a wide display setting cannot be tracked down into a label.
      displayWidthAt84: dWidth,
      labelWidthAt21: Math.round(lLine.width),
      bodyWidthAt26: Math.round(bLine.width),
    })
  } catch (err) {
    skipped.push(`${f.alias} (${String(err.message).slice(0, 40)})`)
  }
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, cv.encodeSync('png'))

console.log(JSON.stringify({
  ok: true,
  out: outPath,
  size: `${W}x${H}`,
  facesSet: results.length,
  skipped,
  // Sorted widest-display first: the widest settings are the candidates for a wordmark,
  // the narrowest for tracked labels.
  widestDisplay: [...results].sort((a, b) => b.displayWidthAt84 - a.displayWidthAt84).slice(0, 6).map((r) => `${r.alias} ${r.displayWidthAt84}`),
  narrowestDisplay: [...results].sort((a, b) => a.displayWidthAt84 - b.displayWidthAt84).slice(0, 6).map((r) => `${r.alias} ${r.displayWidthAt84}`),
  faces: results,
}, null, 2))
