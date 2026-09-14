/**
 * Set the candidate faces at DISPLAY size for the poster's own words, so a face can be
 * judged for a role rather than admired in a catalogue.
 *
 * The full 31-face sheet (`tools/font-specimen.mjs`) answers "what does the catalogue
 * contain". This answers the narrower question a designer actually asks: at the size this
 * page sets its display type, does THIS face do the job — and is it a face that carries a
 * hand, or a face that carries a machine?
 *
 * Each candidate is set at three sizes in the words the page uses, plus its measured width
 * at each, because a face that only works at 200px cannot be used at 24px.
 *
 * Usage: node tools/font-try.mjs [--faces JournalItalic,Antiqua,AntiqueDisplay] [--out out/font-try.png]
 */

import { createCanvas } from '@napi-rs/canvas'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { registerFonts, styleFor, hasFace } from '../src/fonts.mjs'
import { parseFontSpec, measureLine, drawLine } from '../src/text.mjs'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}
const outPath = resolve(process.cwd(), opt('out', 'out/font-try.png'))
const faces = opt('faces', 'JournalItalic,Journal,Antiqua,Bookface,AntiqueDisplay,SongTiBold').split(',')

registerFonts()

const SIZES = [200, 96, 40]
const STRINGS = ['GINKGO', 'Beyond the seasons', 'Ginkgo biloba · autumn']
const PAD = 34
const ROW_H = 150
const W = 1560
const H = PAD * 2 + faces.length * (ROW_H * SIZES.length + 46)

const cv = createCanvas(W, H)
const c = cv.getContext('2d')
c.fillStyle = '#FBFBF6'
c.fillRect(0, 0, W, H)

const measured = []
let y = PAD
for (const alias of faces) {
  if (!hasFace(alias)) { measured.push({ alias, error: 'not registered' }); continue }
  const row = { alias, widths: [] }
  for (const [si, size] of SIZES.entries()) {
    const text = STRINGS[si]
    const spec = parseFontSpec({ family: [alias], size, tracking: si === 1 ? 0.02 : -0.01 }, size)
    const st = styleFor(spec.stack[0], spec.spec)
    c.font = st.font
    if (st.variationSettings !== '') c.fontVariationSettings = st.variationSettings
    const line = measureLine(c, text, spec.stack, spec.spec, spec.trackingEm)
    drawLine(c, { text, ...line }, spec.stack, spec.spec, spec.trackingEm, PAD, y + size * 0.9, W - PAD * 2, 'left', '#4E5427')
    row.widths.push({ size, text, width: Math.round(line.width) })
    y += ROW_H
  }
  c.font = '13px monospace'
  c.fillStyle = '#8A8D80'
  c.fillText(`${alias}   —   ${row.widths.map((w) => `${w.size}px:${w.width}`).join('   ')}`, PAD, y + 12)
  y += 46
  measured.push(row)
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, cv.encodeSync('png'))

console.log(JSON.stringify({
  ok: true,
  out: outPath,
  size: `${W}x${H}`,
  // The number that decides whether a face can be a wordmark at the size this page has
  // room for: its 200px width against the 850px the solid GINKGO occupies today.
  at200: measured.filter((m) => m.widths !== undefined).map((m) => ({
    alias: m.alias,
    ginkgoAt200: m.widths[0].width,
    emPerChar: Math.round((m.widths[0].width / (200 * 6)) * 1000) / 1000,
    fitsTheWordmarkBox: m.widths[0].width <= 900,
  })),
}, null, 2))
