/**
 * Measure how much of each text block a placed image actually covers.
 *
 * WHY THE BOX TEST IS NOT ENOUGH
 * ------------------------------
 * The photograph is L-shaped: it is trimmed to its ink, but the ink itself has large
 * empty regions, so a text block can sit well inside the image's BOUNDING BOX while no
 * pixel of the image touches it. A box-intersection check answers the wrong question and
 * does it pessimistically — it reported five collisions where the ink may cross none.
 *
 * This reads the IMAGE's own alpha, scales it into the placement box, and counts the
 * covered fraction inside each text block's box. That number is what a reader sees.
 *
 * Usage: node tools/audit-image-over-type.mjs <scene.json> [--limit 12]
 */

import { createCanvas, loadImage } from '@napi-rs/canvas'
import { readFileSync } from 'node:fs'
import { resolve, isAbsolute } from 'node:path'

const args = process.argv.slice(2)
const file = isAbsolute(args[0]) ? args[0] : resolve(process.cwd(), args[0])
const limit = Number(args.includes('--limit') ? args[args.indexOf('--limit') + 1] : 12)

const scene = JSON.parse(readFileSync(file, 'utf8'))
const flat = []
const walk = (ls) => ls.forEach((l) => { flat.push(l); if (Array.isArray(l.children)) walk(l.children) })
walk(scene.layers)

const images = flat.filter((l) => l.shape === 'image' && typeof l.x === 'number' && typeof l.w === 'number' && l.w > 1)
const texts = flat.filter((l) => l.shape === 'text' && l.text)

// A text block's drawn extent. The renderer takes `w` as the wrap box and lays the lines
// inside it; the height is the line count times the leading. An over-estimate is safe here
// because it can only make this check MORE suspicious, not less.
const textBox = (l) => {
  const size = l.font === undefined ? 16 : l.font.size
  const lines = String(l.text).split('\n').length
  const lh = l.lineHeight === undefined ? size * 1.35 : (l.lineHeight > 4 ? l.lineHeight : l.lineHeight * size)
  return { x: l.x ?? 0, y: l.y ?? 0, w: (l.w ?? 400), h: lines * lh }
}

/**
 * The layer's own mask, evaluated at a point inside its box.
 *
 * WITHOUT THIS THE AUDIT LIES. It reported 65% ink coverage on the footer line under the
 * maple, which sounded like a real collision — but that layer carries a vertical fade mask
 * that has already taken it to about 8% opacity by that height, so the true coverage is
 * nearer 5%. A checker that reads the raw image and ignores the mask is measuring a layer
 * the renderer never draws.
 *
 * Only the shape this project uses is handled: a rect with a linear paint and explicit
 * stops. Anything else returns 1, so an unsupported mask makes the audit MORE pessimistic
 * rather than silently forgiving.
 */
function maskAlphaAt(mask, u, v) {
  if (mask === undefined || mask === null) return 1
  const shapes = Array.isArray(mask.shapes) ? mask.shapes : [mask]
  const shape = shapes[0]
  if (shape === undefined || shape.paint === undefined || typeof shape.paint !== 'object') return 1
  const paint = shape.paint
  if (paint.type !== 'linear' || !Array.isArray(paint.stops)) return 1

  // The gradient axis. `angle` is in degrees, 0 = left-to-right and 90 = top-to-bottom,
  // matching the renderer's own convention for the masks used here.
  const a = ((paint.angle === undefined ? 0 : paint.angle) * Math.PI) / 180
  const t = Math.max(0, Math.min(1, Math.cos(a) * u + Math.sin(a) * v))

  let lo = paint.stops[0]
  let hi = paint.stops[paint.stops.length - 1]
  for (let i = 1; i < paint.stops.length; i++) {
    if (t <= paint.stops[i].at) { lo = paint.stops[i - 1]; hi = paint.stops[i]; break }
  }
  const span = hi.at - lo.at
  const k = span <= 0 ? 0 : (t - lo.at) / span
  const a0 = lo.alpha === undefined ? 1 : lo.alpha
  const a1 = hi.alpha === undefined ? 1 : hi.alpha
  return a0 + (a1 - a0) * k
}

const results = []
for (const img of images) {
  let source
  try {
    source = await loadImage(img.src)
  } catch {
    continue
  }
  const cv = createCanvas(source.width, source.height)
  const c = cv.getContext('2d')
  c.drawImage(source, 0, 0)
  const d = c.getImageData(0, 0, source.width, source.height).data

  // `fit: 'stretch'` maps the file onto the box linearly, with no cropping, so a sample in
  // box space reads straight out of file space.
  for (const t of texts) {
    const tb = textBox(t)
    const x0 = Math.max(tb.x, img.x)
    const y0 = Math.max(tb.y, img.y)
    const x1 = Math.min(tb.x + tb.w, img.x + img.w)
    const y1 = Math.min(tb.y + tb.h, img.y + img.h)
    if (x1 <= x0 || y1 <= y0) continue

    let sampled = 0
    let covered = 0
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        const u = (x - img.x) / img.w
        const v = (y - img.y) / img.h
        const sx = Math.min(source.width - 1, Math.max(0, Math.round(u * source.width)))
        const sy = Math.min(source.height - 1, Math.max(0, Math.round(v * source.height)))
        sampled++
        const ink = d[(sy * source.width + sx) * 4 + 3] > 40 ? 1 : 0
        // Weighted by the layer's own opacity and mask: this is what the page shows.
        covered += ink * (img.opacity === undefined ? 1 : img.opacity) * maskAlphaAt(img.mask, u, v)
      }
    }
    if (sampled === 0) continue
    const share = covered / sampled
    // Only the region of the text that the image's own box covers is meaningful, so the
    // share is reported against the INTERSECTION rather than against the whole block.
    if (share > 0.02) {
      results.push({
        image: img.id,
        text: t.id,
        coveredShareOfText: Math.round(share * 100) / 100,
        intersection: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
      })
    }
  }
}

results.sort((a, b) => b.coveredShareOfText - a.coveredShareOfText)

console.log(JSON.stringify({
  ok: results.filter((r) => r.coveredShareOfText > 0.25).length === 0,
  scene: file,
  images: images.map((i) => i.id),
  textBlocks: texts.length,
  // Above ~0.25 the type is fighting the picture; below it, the picture is behind the type
  // and the reader can still parse the line.
  threshold: 0.25,
  overThreshold: results.filter((r) => r.coveredShareOfText > 0.25).length,
  worst: results.slice(0, limit),
}, null, 2))
