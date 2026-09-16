/**
 * make-alpha-fixture — generate a frame sequence whose alpha is KNOWN.
 *
 * WHY THIS EXISTS. video-probe estimates an element's alpha by regressing its
 * rendered colour on the backdrop behind it. An estimator like that is worthless
 * until it has been shown to recover a value that was set on purpose. So this
 * tool builds a clip where the answer is written down in advance: a flat element
 * of known colour is composited at a known alpha over a backdrop that scrolls,
 * and the truth is written to truth.json beside the frames.
 *
 * Without this step, a plausible-looking number out of video-probe would be
 * indistinguishable from a broken regression.
 *
 * Usage: node tools/make-alpha-fixture.mjs <outdir> <alpha> [opts]
 *        alpha 1.0 = opaque, 0.5 = half, 0 = element invisible
 *        opts: --frames N (default 60)  --w W  --h H (default 640x360)
 *              --move PX  horizontal backdrop travel per frame (default 5)
 *              --colour RRGGBB (element colour, default ffffff)
 *              --ex X --ey Y --ew W --eh H   element rect in pixels
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'

const argv = process.argv.slice(2)
const outdir = argv[0]
const alpha = Number(argv[1])
const opt = {}
for (let i = 2; i < argv.length; i++) {
  if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1]
}
if (!outdir || !Number.isFinite(alpha)) {
  console.log('Usage: node tools/make-alpha-fixture.mjs <outdir> <alpha> [--frames N] [--w W] [--h H] [--move PX] [--colour RRGGBB] [--ex X --ey Y --ew W --eh H]')
  process.exit(2)
}

const FRAMES = Number(opt.frames ?? 60)
const W = Number(opt.w ?? 640), H = Number(opt.h ?? 360)
const MOVE = Number(opt.move ?? 5)
const hexToRgb = h => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
const F = hexToRgb(String(opt.colour ?? 'ffffff'))

// element rect, and a backdrop probe patch directly BELOW it. The probe patch is
// at the same x range, so on this fixture the backdrop under the element and the
// backdrop beside it are identical by construction — that isolates the ESTIMATOR
// from the adjacent-backdrop ASSUMPTION, which is a separate thing to test.
const EX = Number(opt.ex ?? 400), EY = Number(opt.ey ?? 120)
const EW = Number(opt.ew ?? 90), EH = Number(opt.eh ?? 64)
const PROBE_Y = EY + EH + 10

rmSync(outdir, { recursive: true, force: true })
mkdirSync(outdir, { recursive: true })

const cv = createCanvas(W, H)
const ctx = cv.getContext('2d')

/** backdrop: three channels scrolling at different rates, so per-channel
 *  alphas are genuinely independent rather than one number repeated three times. */
function backdrop(x, y, t) {
  const sx = (x + t * MOVE) % W
  const u = sx / W
  const r = 20 + u * 220
  const g = 240 - u * 200
  const b = 40 + (((x * 2 + t * MOVE * 1.7) % W) / W) * 180
  return [r, g, b]
}

for (let t = 0; t < FRAMES; t++) {
  const img = ctx.createImageData(W, H)
  const d = img.data
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let [r, g, b] = backdrop(x, y, t)
      if (x >= EX && x < EX + EW && y >= EY && y < EY + EH) {
        r = alpha * F[0] + (1 - alpha) * r
        g = alpha * F[1] + (1 - alpha) * g
        b = alpha * F[2] + (1 - alpha) * b
      }
      const i = (y * W + x) * 4
      d[i] = Math.max(0, Math.min(255, Math.round(r)))
      d[i + 1] = Math.max(0, Math.min(255, Math.round(g)))
      d[i + 2] = Math.max(0, Math.min(255, Math.round(b)))
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const buf = typeof cv.encode === 'function' ? await cv.encode('png') : cv.toBuffer('image/png')
  // zero-padded so lexical and natural order agree — video-probe must not be
  // rescued by a lucky filename.
  writeFileSync(join(outdir, String(t + 1).padStart(3, '0') + '.png'), buf)
}

const f = (v, den) => Number((v / den).toFixed(6))
const truth = {
  alpha,
  elementColour: '#' + F.map(v => v.toString(16).padStart(2, '0')).join(''),
  frames: FRAMES,
  size: { w: W, h: H },
  backdropTravelPxPerFrame: MOVE,
  elementRoi: [f(EX, W), f(EY, H), f(EW, W), f(EH, H)],
  backdropRoi: [f(EX, W), f(PROBE_Y, H), f(EW, W), f(EH, H)],
  expectedVerdict: MOVE === 0 ? 'CANNOT DECIDE' : (alpha >= 0.90 ? 'OPAQUE' : 'TRANSLUCENT'),
}
writeFileSync(join(outdir, 'truth.json'), JSON.stringify(truth, null, 2))
console.log(JSON.stringify(truth, null, 2))
console.log(`\nwrote ${FRAMES} frames to ${outdir}`)
console.log(`run:  node tools/video-probe.mjs alpha ${outdir} ${truth.elementRoi.join(' ')} ${truth.backdropRoi.join(' ')}`)
