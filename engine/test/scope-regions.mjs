/**
 * Scope, verified end to end through the real renderer.
 *
 * WHY THIS TEST LOOKS THE WAY IT DOES
 * -----------------------------------
 * Two mistakes shaped it, and both are recorded because they are the same mistake
 * in different clothes — measuring the wrong thing and then believing the number.
 *
 * 1. An earlier version sampled THIRDS OF THE LAYER'S BOX. The subject is
 *    `contain`-fitted into a 560x520 box, so it occupies a narrow column and most of
 *    a "top third" is empty white. Averaging transparent pixels in dragged every
 *    mean toward zero, so all four cases read as equally desaturated and a working
 *    feature looked broken.
 *
 * 2. Render errors were swallowed. The first run produced no image at all — every
 *    case threw — and the assertions cheerfully compared two empty files. What
 *    turned that into a one-line diagnosis was letting the throw through.
 *
 * So: saturation is measured over INKED, CHROMATIC pixels only, within bands of the
 * subject's own ink extent (found from the alpha, not assumed); and a render failure
 * aborts loudly. The four renders are written to `out/` so the numbers can be
 * checked against the pictures rather than believed.
 *
 * Run: node test/scope-regions.mjs
 */
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'
import { renderScene } from '../src/render.mjs'

const W = 900
const H = 620
const SUBJECT = 'D:/DSH_GDT/DSH_GraphicDesign_Tools/engine/assets/haruka-figure.png'

/** A full-strength duotone to olive. Deliberately strong, so "unchanged" can only
 *  mean the scope did the work and never that the effect was weak. */
function scene(scope) {
  return {
    canvas: { width: W, height: H },
    ground: '#FFFFFF',
    layers: [{
      id: 'subject',
      shape: 'image',
      src: SUBJECT,
      x: 300, y: 40, w: 560, h: 520,
      fit: 'contain',
      effects: [{ type: 'duotone', shadows: '#2E3324', midtones: '#6E7742', highlights: '#EFEFE2', strength: 1, scope }],
    }],
  }
}

const cases = {
  'scope-A-none': undefined,
  'scope-B-bottom': { type: 'ramp', angle: 90, stops: ['#000000', '#FFFFFF'] },
  'scope-C-top': { type: 'ramp', angle: 90, stops: ['#000000', '#FFFFFF'], invert: true },
  'scope-D-ellipse': { shape: 'ellipse', x: 0.42, y: 0.10, w: 0.30, h: 0.45, paint: '#FFFFFF' },
}

const reported = {}
for (const [name, scope] of Object.entries(cases)) {
  let out
  try {
    out = await renderScene(scene(scope), { baseDir: process.cwd() })
  } catch (e) {
    // Never swallow this: a silent throw here once made the whole suite compare
    // empty files and report nonsense.
    console.log('  ' + name + ': RENDER THREW -> ' + e.message)
    throw e
  }
  writeFileSync('out/' + name + '.png', out.canvas.toBuffer('image/png'))
  const rec = out.report.log.find((e) => e.step === 'layer' && e.id === 'subject')
  reported[name] = rec?.drawn?.effects?.[0]?.scope ?? null
  console.log('  ' + name.padEnd(18) + ' scope in report: ' + JSON.stringify(reported[name]))
}

/**
 * Share of inked pixels that are OLIVE, in a band of the subject's own extent.
 *
 * WHY NOT SATURATION
 * ------------------
 * Saturation was the first choice and it does not work: the olive the duotone maps
 * to is MORE saturated (0.30-0.47) than the subject's own reds and blues (0.25-0.30),
 * so the two states are not separated by it at all. That is a fixture problem, not a
 * filter problem — the wrong statistic was being measured, and it was measured
 * precisely.
 *
 * Hue is what actually separates them. The subject is red, blue, skin and white; the
 * duotone is one olive. So the discriminator is "what fraction of the inked pixels
 * fall in the olive hue range", which goes from near 0 to near 1 and is therefore
 * readable as a number rather than argued about.
 */
async function oliveShare(png, yFrac0, yFrac1) {
  const img = await loadImage(png)
  const c = createCanvas(img.width, img.height)
  c.getContext('2d').drawImage(img, 0, 0)
  const d = c.getContext('2d').getImageData(0, 0, img.width, img.height).data
  let top = -1
  let bottom = -1
  for (let y = 0; y < img.height; y++) {
    let inked = false
    for (let x = 0; x < img.width; x++) {
      if (d[(y * img.width + x) * 4 + 3] > 8) { inked = true; break }
    }
    if (inked) { if (top < 0) top = y; bottom = y }
  }
  const y0 = Math.round(top + (bottom - top) * yFrac0)
  const y1 = Math.round(top + (bottom - top) * yFrac1)
  let olive = 0
  let inked = 0
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4
      if (d[i + 3] < 200) continue
      const r = d[i] / 255
      const g = d[i + 1] / 255
      const b = d[i + 2] / 255
      const mx = Math.max(r, g, b)
      const mn = Math.min(r, g, b)
      if (mx < 0.10) continue                       // pure black carries no hue
      if (mx - mn < 0.06) continue                  // near-neutral: count as neither
      inked++
      // The duotone's olive sits around 70-90 degrees: green dominant, red close
      // behind it, blue clearly lower. The subject's reds are red-dominant and its
      // blues are blue-dominant, so neither qualifies.
      if (g >= r - 0.06 && g > b + 0.08 && r > b) olive++
    }
  }
  return inked === 0 ? 0 : olive / inked
}

const BANDS = { top: [0.02, 0.32], oval: [0.18, 0.45], bottom: [0.68, 0.98] }
const table = {}
for (const name of Object.keys(cases)) {
  table[name] = {}
  for (const [where, [a, b]] of Object.entries(BANDS)) {
    table[name][where] = await oliveShare('out/' + name + '.png', a, b)
  }
}

console.log('\nSHARE OF INKED PIXELS THAT ARE OLIVE (the duotone colour)')
console.log('  case                top    oval   bottom')
for (const name of Object.keys(cases)) {
  const r = table[name]
  console.log('  ' + name.padEnd(18) + r.top.toFixed(3).padStart(7) + r.oval.toFixed(3).padStart(7) + r.bottom.toFixed(3).padStart(8))
}

let failed = 0
let checks = 0
const check = (label, ok, detail) => {
  checks++
  if (ok) console.log('  ok    ' + label + (detail ? '  — ' + detail : ''))
  else { failed++; console.log('  FAIL  ' + label + (detail ? '  — ' + detail : '')) }
}

const A = table['scope-A-none']
const B = table['scope-B-bottom']
const C = table['scope-C-top']
const D = table['scope-D-ellipse']

console.log('\nASSERTIONS')
// DIRECTION OF THE MEASUREMENT, stated so the assertions cannot be read backwards:
// a HIGH olive share means the duotone REACHED that band; a LOW one means the band
// kept the subject's own hues, i.e. the scope kept the effect out.
check('A: an unscoped duotone reaches every band',
  A.top > 0.6 && A.oval > 0.6 && A.bottom > 0.6,
  'top ' + A.top.toFixed(3) + ', oval ' + A.oval.toFixed(3) + ', bottom ' + A.bottom.toFixed(3))

// The feature working: one layer, two treatments. B is scoped to the BOTTOM, so the
// top must keep the subject's own reds and blues while the bottom goes olive.
check('B: the scoped-out TOP keeps the subject hues',
  B.top < A.top / 4, 'top olive ' + B.top.toFixed(3) + ' vs unscoped ' + A.top.toFixed(3))
check('B: the scoped-in BOTTOM receives the duotone',
  B.bottom > B.top * 5 && B.bottom > 0.3, 'bottom olive ' + B.bottom.toFixed(3) + ' vs top ' + B.top.toFixed(3))

// invert must mirror B at BOTH ends. A single-ended check passes a scope that
// silently ignores the flag, which is the failure most worth catching here.
check('C: invert mirrors B at the top',
  C.top > 0.4 && C.top > B.top * 5, 'top olive ' + C.top.toFixed(3) + ' vs B ' + B.top.toFixed(3))
check('C: invert mirrors B at the bottom',
  C.bottom < B.bottom / 3, 'bottom olive ' + C.bottom.toFixed(3) + ' vs B ' + B.bottom.toFixed(3))

// D confines the effect to an oval over the upper body: the oval receives the
// duotone, the lower body does not.
check('D: inside the ellipse receives the duotone',
  D.oval > 0.6, 'oval olive ' + D.oval.toFixed(3))
check('D: outside the ellipse keeps the subject hues',
  D.bottom < A.bottom / 4, 'bottom olive ' + D.bottom.toFixed(3) + ' vs unscoped ' + A.bottom.toFixed(3))

// The report must say what the scope was, so a render can be audited after the
// fact rather than only by looking at it.
check('the report names the scope applied', reported['scope-B-bottom'] !== null,
  JSON.stringify(reported['scope-B-bottom']))
check('an unscoped effect reports no scope', reported['scope-A-none'] === null)

console.log('\n=== ' + (failed === 0 ? checks + '/' + checks + ' scope checks passed' : failed + ' FAILED') + ' ===')
console.log('pictures: out/scope-A-none.png, scope-B-bottom.png, scope-C-top.png, scope-D-ellipse.png')
process.exit(failed === 0 ? 0 : 1)
