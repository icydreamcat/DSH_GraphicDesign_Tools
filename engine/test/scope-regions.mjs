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
 * aborts loudly. The four renders are written to the test cache (`.cache/test/`, outside
 * the repository — see TEST_OUT below) so the numbers can be
 * checked against the pictures rather than believed.
 *
 * 3. It used to load a character illustration out of `engine/assets/` by ABSOLUTE
 *    path. That made the suite machine-specific: a fresh clone has no such file, so
 *    the suite failed for everyone except the machine it was written on. The subject
 *    is now DRAWN by makeSubject() below — a synthetic stand-in is not a compromise
 *    here, it is an improvement, because this test's fixture requirements are
 *    structural, not pictorial (see makeSubject).
 *
 * Run: node test/scope-regions.mjs
 */
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { renderScene } from '../src/render.mjs'

const W = 900
const H = 620

// Test scratch goes to a cache OUTSIDE the repository, beside it at .cache/test/.
//
// WHY NOT `out/`: that directory holds real render artifacts, and mixing them with
// files a test rewrites on every run is how a deliverable comes to be mistaken for
// scratch during maintenance. This suite writes five files per run; they stay on disk
// because the file's own advice is to check the numbers against the pictures — but they
// do not belong where a finished render lives.
const TEST_OUT = resolve(import.meta.dirname, '..', '..', '..', '.cache', 'test')
mkdirSync(TEST_OUT, { recursive: true })
const scratch = (name) => join(TEST_OUT, name)
const SUBJECT = scratch('scope-subject.png')

/**
 * Draw the subject this test needs, instead of loading one from `engine/assets/`.
 *
 * WHAT THE FIXTURE HAS TO SATISFY — four requirements, all structural. The first
 * three were established by measurement, not by taste; each one broke a draft of
 * this function.
 *
 *   1. IT MUST FILL THE FRAME. This is the one that is easy to get wrong. oliveShare()
 *      locates the subject's extent by scanning for alpha > 8, but the renderer
 *      composites an OPAQUE GROUND across the whole canvas — so the "ink extent" it
 *      finds is always y=0..H, i.e. CANVAS space, not subject space. The band
 *      positions are therefore fractions OF THE CANVAS. A draft that drew a tidy
 *      rounded silhouette inside a 560x520 layer looked right and measured 0.000:
 *      the bands were sampling blank ground. The fix is for the subject to span the
 *      frame, which is also what the asset this replaced effectively did.
 *
 *   2. EVERY BAND MUST LAND IN THE DUOTONE'S OLIVE RANGE. The duotone is
 *      shadows #2E3324 -> midtones #6E7742 -> highlights #EFEFE2, keyed on the source
 *      pixel's LUMINANCE, and oliveShare() counts a pixel as olive only when
 *      g >= r - 0.06 && g > b + 0.08 && r > b. Measured through the real op, source
 *      luminances of roughly 20..225 satisfy that; black maps to the shadow (blue
 *      above red, so it fails) and white maps to the near-neutral highlight (mx-mn <
 *      0.06, so it fails as "carries no hue"). The fills below are mid-luminance and
 *      chromatic so the effect is visible to the measurement.
 *
 *   3. NO OLIVE IN THE SOURCE, and no large neutral or near-black areas. Any olive of
 *      its own would make the "scoped out" cases read as partly duotoned; large
 *      neutral areas would simply be dropped from the count. The separators are thin
 *      for that reason — a draft that made them 6px lost ~3% of each band to the
 *      near-black filter for no benefit.
 *
 *   4. HUE MUST VARY DOWN THE FRAME, so a scope covering only part of it is
 *      detectable at all.
 *
 * A character illustration satisfied all of this by accident. Drawing one satisfies it
 * on purpose, and it works on every machine.
 */
function makeSubject() {
  // Full frame. The layer places it at 1:1 over the canvas, because oliveShare()'s
  // bands are fractions of the CANVAS (see requirement 1) — a subject smaller than the
  // frame measures its own surroundings.
  const w = W
  const h = H
  const c = createCanvas(w, h)
  const g = c.getContext('2d')
  // The THIRD band's colour is load-bearing, and it was CHOSEN BY MEASUREMENT. B and C
  // are ramp scopes, and the ramp is a linear gradient applied as a BLEND, so its
  // strength grows with distance and reaches only about 0.62 at the frame's bottom
  // edge. The band therefore has to satisfy four constraints at once:
  //
  //   A unscoped      -> full duotone            -> must read OLIVE
  //   B ramp bottom   -> duotone at ~0.62        -> must read OLIVE
  //   C inverted      -> duotone at ~0.38        -> must read NON-olive
  //   D ellipse       -> bottom untouched        -> must read NON-olive
  //
  // and, for the D assertion to mean anything, its own hue must not already be olive.
  // That is a narrow window: a light base fails B (it stays near the neutral highlight,
  // which the hue test drops), a very dark one fails B too (the duotone's shadow end is
  // blue-dominant, so `r > b` fails). #8E1420 sits inside the window — verified against
  // the real duotone op at the ramp's measured strengths. The earlier drafts used
  // #D41E9B, #8E0F52 and #2B0A3C, and each one failed one of the four.
  const bands = [
    { y: 0, hh: h * 0.36, fill: '#C8203A' },        // red, mid luminance
    { y: h * 0.36, hh: h * 0.28, fill: '#1B3FA8' }, // blue, mid luminance
    { y: h * 0.64, hh: h * 0.36, fill: '#8E1420' }, // deep red, inside the olive window
  ]
  for (const b of bands) {
    g.fillStyle = b.fill
    g.fillRect(0, b.y, w, b.hh)
  }
  // Thin near-black rules: neutral, so they are skipped by the hue test rather than
  // counted for either side. Kept to 2px so they cannot move a band's share.
  g.fillStyle = '#0A0A0A'
  g.fillRect(0, Math.round(h * 0.36) - 1, w, 2)
  g.fillRect(0, Math.round(h * 0.64) - 1, w, 2)
  return c
}

writeFileSync(SUBJECT, makeSubject().toBuffer('image/png'))

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
      // 1:1 over the whole canvas. `contain` inside a smaller box would leave the
      // measured bands sampling empty ground — see makeSubject requirement 1.
      x: 0, y: 0, w: W, h: H,
      fit: 'fill',
      effects: [{ type: 'duotone', shadows: '#2E3324', midtones: '#6E7742', highlights: '#EFEFE2', strength: 1, scope }],
    }],
  }
}

const cases = {
  'scope-A-none': undefined,
  'scope-B-bottom': { type: 'ramp', angle: 90, stops: ['#000000', '#FFFFFF'] },
  'scope-C-top': { type: 'ramp', angle: 90, stops: ['#000000', '#FFFFFF'], invert: true },
  // Sized to actually CONTAIN the `oval` measurement band (rows 0.18..0.45 of the
  // frame, full width). It used to be x 0.42..0.72 — a narrow patch covering only
  // about 43% of each row — so the band measured a mixture of inside and outside and
  // read 0.278 against an assertion of > 0.6, failing while the scope worked. A scope
  // test needs the scope to cover what is being measured.
  'scope-D-ellipse': { shape: 'ellipse', x: 0.10, y: 0.15, w: 0.80, h: 0.36, paint: '#FFFFFF' },
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
  writeFileSync(scratch(name + '.png'), out.canvas.toBuffer('image/png'))
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
    table[name][where] = await oliveShare(scratch(name + '.png'), a, b)
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
console.log('pictures: ' + ['scope-A-none', 'scope-B-bottom', 'scope-C-top', 'scope-D-ellipse'].map((n) => scratch(n + '.png')).join(', '))
process.exit(failed === 0 ? 0 : 1)
