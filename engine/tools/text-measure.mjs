/**
 * Measure real text widths through the engine's own font stack.
 *
 * The render report returns `widest: 0` for any layer with `wrap: false`
 * (single-line mode skips `layoutParagraph`), so a headline's actual width is
 * invisible in the report — and the wordmark's fit is exactly the number that
 * decides whether it can be set large enough to satisfy the verifier's type-step
 * rule. Guessing here would mean either a wordmark that overflows the canvas or
 * a type ladder that fails its own check.
 *
 * Usage: node tools/text-measure.mjs "<text>" <family> <size> [--width 76] [--weight 700] [--tracking -0.035]
 */

import { createCanvas } from '@napi-rs/canvas'
import { registerFonts, styleFor, hasFace } from '../src/fonts.mjs'
import { measureLine, parseFontSpec } from '../src/text.mjs'

registerFonts()

const args = process.argv.slice(2)
const text = args[0]
const family = args[1] === undefined ? 'Grotesk' : args[1]
const size = args[2] === undefined ? 168 : Number(args[2])
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback
}
const width = opt('width', 100)
const weight = opt('weight', 700)
const tracking = opt('tracking', -0.035)

if (!hasFace(family)) {
  console.error(`unknown font family "${family}" — run: node bin/design.mjs fonts`)
  process.exit(1)
}

// go through the renderer's own parseFontSpec so the stack, the trailing-letter
// correction and the variation settings are exactly what a scene layer gets.
const parsed = parseFontSpec({ family: [family], size, weight, width, tracking }, size)

// A small context is enough: text metrics do not depend on the surface size,
// but the font must be applied to the context before measuring.
const ctx = createCanvas(8, 8).getContext('2d')
const style = styleFor(parsed.stack[0], parsed.spec)
ctx.font = style.font
if (style.variationSettings !== '') ctx.fontVariationSettings = style.variationSettings

const measured = measureLine(ctx, text, parsed.stack, parsed.spec, parsed.trackingEm)

const rows = []
for (const [canvasW, label] of [[2560, 'full canvas'], [2178, 'to the seam'], [860, 'to the page edge'], [760, 'inside the right block']]) {
  rows.push({ against: label, canvasWidth: canvasW, fits: measured.width <= canvasW, spare: Math.round(canvasW - measured.width) })
}

console.log(JSON.stringify({
  ok: true,
  text,
  family,
  size,
  width,
  weight,
  tracking,
  measuredWidth: Math.round(measured.width * 100) / 100,
  advancePerEm: Math.round((measured.width / (size * text.length)) * 1000) / 1000,
  fit: rows,
  // What the type-step rule needs: the largest text must be >= 1.25x the next.
  maxSecondaryForThisSize: Math.round(size / 1.25),
}, null, 2))
