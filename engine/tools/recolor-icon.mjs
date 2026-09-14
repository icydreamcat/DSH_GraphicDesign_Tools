/**
 * Recolour an icon to the page's ink.
 *
 * WHY THIS EXISTS
 * ---------------
 * The icon packs in the material library are black silhouettes on transparent.
 * Dropping one onto this poster unchanged puts a black block on a page whose
 * whole premise is that there is no black anywhere except the illustration — so
 * every icon would become the heaviest object on the sheet.
 *
 * The engine cannot fix this on its own. `tint` composites with `multiply`, and
 * black multiplied by olive is still black: the operation can darken a mark but
 * it cannot recolour one. So the recolour has to happen to the file.
 *
 * Recovers the mark by its ALPHA channel and rewrites its RGB onto a ramp:
 *
 *   flat     silhouette packs (ignoredones, Vol.2/3/5) are literally one ink
 *            value, so every inked pixel gets the target colour. This is what
 *            turns a black glyph into a clean olive one.
 *   duotone  for marks that carry internal tone (anti-aliased edges, or a pack
 *            with white and grey in it), the pixel's own luminance is mapped
 *            onto a two-stop ramp so the detail survives the colour change.
 *   knockout the inverse: the mark keeps the page's paper colour and the
 *            surrounding film is filled with an ink colour, which is how a
 *            "punched out of the page" figure is made.
 *
 * `--gamma` reshapes the ramp. On an anti-aliased silhouette the edge pixels
 * sit at partial alpha, and a flat fill makes them read as a hard cut at small
 * display sizes; a gamma above 1 keeps more of the ramp so a 20px icon still
 * looks like a drawing rather than a blob.
 *
 * Usage:
 *   node tools/recolor-icon.mjs <in.png> <out.png> [--ink #9CA25C] [--mode flat|duotone|knockout]
 *                               [--second #FBFBF6] [--gamma 1] [--scale 2]
 *   node tools/recolor-icon.mjs --batch <list.json> <outDir>
 */

import { createCanvas, loadImage } from '@napi-rs/canvas'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, isAbsolute, basename, join } from 'node:path'
import { parseColor } from '../src/color.mjs'

const args = process.argv.slice(2)

const opt = (name, fallback) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}

/**
 * Recolour one image buffer.
 *
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img
 * @param {{ink:string, second:string, mode:string, gamma:number}} spec
 */
function recolor(img, spec) {
  const ink = parseColor(spec.ink)
  const second = parseColor(spec.second)
  const gamma = spec.gamma
  const d = img.data
  let touched = 0

  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]
    if (a === 0) continue
    if (spec.mode === 'knockout') {
      // The mark is whatever was transparent; the film is whatever was inked.
      const film = a / 255
      d[i] = second.r * (1 - film) + ink.r * film
      d[i + 1] = second.g * (1 - film) + ink.g * film
      d[i + 2] = second.b * (1 - film) + ink.b * film
      d[i + 3] = 255
      touched++
      continue
    }
    if (spec.mode === 'flat') {
      d[i] = ink.r
      d[i + 1] = ink.g
      d[i + 2] = ink.b
      touched++
      continue
    }
    // duotone: the mark's own luminance picks the position on the ramp, so an
    // icon that contains white and grey detail keeps it after the recolour.
    const lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255
    const t = Math.pow(lum, 1 / Math.max(0.05, gamma))
    d[i] = ink.r + (second.r - ink.r) * t
    d[i + 1] = ink.g + (second.g - ink.g) * t
    d[i + 2] = ink.b + (second.b - ink.b) * t
    touched++
  }
  return { touched, total: d.length / 4 }
}

/** Recolour a single file, optionally upscaling with high-quality resampling. */
async function recolorFile(inPath, outPath, spec, scale) {
  const abs = isAbsolute(inPath) ? inPath : resolve(process.cwd(), inPath)
  const img = await loadImage(readFileSync(abs))
  const cv = createCanvas(img.width, img.height)
  const ctx = cv.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, cv.width, cv.height)
  const r = recolor(data, spec)
  ctx.putImageData(data, 0, 0)

  let out = cv
  if (scale !== 1) {
    // Lanczos-ish quality on the upscale matters: these packs are 250-970px and
    // a poster seat may be larger. Upscaling HERE rather than in the scene keeps
    // the scene's image layers at a clean integer size.
    const up = createCanvas(Math.round(cv.width * scale), Math.round(cv.height * scale))
    const uctx = up.getContext('2d')
    uctx.imageSmoothingEnabled = true
    uctx.imageSmoothingQuality = 'high'
    uctx.drawImage(cv, 0, 0, up.width, up.height)
    out = up
  }

  const outAbs = isAbsolute(outPath) ? outPath : resolve(process.cwd(), outPath)
  mkdirSync(resolve(outAbs, '..'), { recursive: true })
  writeFileSync(outAbs, out.encodeSync('png'))
  return { input: abs, output: outAbs, size: { w: out.width, h: out.height }, touched: r.touched, inked: r.total }
}

if (args.includes('--batch')) {
  const listPath = resolve(process.cwd(), args[args.indexOf('--batch') + 1])
  const outDir = resolve(process.cwd(), args[args.indexOf('--batch') + 2])
  // Strip a UTF-8 BOM: PowerShell's `Set-Content -Encoding UTF8` writes one, and
  // JSON.parse rejects it with a message ("Unexpected token") that points at the
  // data rather than at the encoding.
  const list = JSON.parse(readFileSync(listPath, 'utf8').replace(/^\uFEFF/, ''))
  const results = []
  for (const item of list) {
    const spec = {
      ink: item.ink === undefined ? '#9CA25C' : item.ink,
      second: item.second === undefined ? '#FBFBF6' : item.second,
      mode: item.mode === undefined ? 'flat' : item.mode,
      gamma: item.gamma === undefined ? 1 : item.gamma,
    }
    const scale = item.scale === undefined ? 1 : item.scale
    const name = item.out === undefined ? basename(item.in).replace(/\.png$/i, '') + '.png' : item.out
    try {
      results.push(await recolorFile(item.in, join(outDir, name), spec, scale))
    } catch (err) {
      results.push({ input: item.in, error: String(err.message) })
    }
  }
  console.log(JSON.stringify({ ok: true, count: results.length, results }, null, 2))
} else {
  const [input, output] = args
  if (input === undefined || output === undefined) {
    console.error('usage: node tools/recolor-icon.mjs <in.png> <out.png> [--ink #RRGGBB] [--mode flat|duotone|knockout] [--second #RRGGBB] [--gamma 1] [--scale 1]')
    process.exit(1)
  }
  const spec = {
    ink: opt('ink', '#9CA25C'),
    second: opt('second', '#FBFBF6'),
    mode: opt('mode', 'flat'),
    gamma: Number(opt('gamma', 1)),
  }
  const result = await recolorFile(input, output, spec, Number(opt('scale', 1)))
  console.log(JSON.stringify({ ok: true, ...result, spec }, null, 2))
}
