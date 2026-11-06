/**
 * crop-view — cut a true-resolution window out of a render.
 *
 * The preview pipeline downscales a 2400x3394 sheet to about 1060px wide, which
 * is 44% — so a 320px display character arrives at 141px and a 12px micro-label
 * arrives at 5px. Judging type at that scale is judging a different design. This
 * writes 1:1 crops so the craft can actually be seen: does the CJK outlining hold
 * at the terminals, is the 14px footer readable, does a 1px hairline still read
 * as a hairline rather than a grey smear.
 *
 * Usage: node tools/crop-view.mjs <png> <out.png> <x> <y> <w> <h> [scale]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const [, , SRC, OUT, x, y, w, h, scaleArg] = process.argv
const scale = Number(scaleArg ?? 1)

const img = await loadImage(readFileSync(SRC))
const W = img.width, H = img.height
const sx = Math.max(0, Math.round(Number(x))), sy = Math.max(0, Math.round(Number(y)))
const sw = Math.min(W - sx, Math.round(Number(w))), sh = Math.min(H - sy, Math.round(Number(h)))

const cv = createCanvas(Math.round(sw * scale), Math.round(sh * scale))
const ctx = cv.getContext('2d')
ctx.imageSmoothingEnabled = scale < 1
ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height)
writeFileSync(OUT, cv.toBuffer('image/png'))
console.log(`${SRC} [${sx},${sy} ${sw}x${sh}] -> ${OUT} at ${scale}x (${cv.width}x${cv.height})`)
