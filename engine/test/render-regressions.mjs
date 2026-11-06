/**
 * Regression tests for two defects found by looking at rendered posters.
 *
 * Both were invisible to the report and to the tool suite: the posters rendered with
 * zero warnings and every check passed, and the faults were only visible in the
 * picture. That is why each test here asserts the DEFECT'S SIGNATURE rather than
 * merely "the scene renders".
 *
 * DEFECT 1 — a line drawn from the canvas corner
 * ----------------------------------------------
 * A `line` runs from (x1, y1) to (x2, y2); it ignores `x`/`y`, and both endpoints
 * default to the canvas edges. A generator written as
 * `{ shape:'line', x: 96, y: 153, x2: 2304, y2: 153 }` reads like "a horizontal rule
 * at y=153", but draws from (0, 0) to (2304, 153) — an unintended diagonal slash
 * across the artwork. The signature is ink in the LEFT PART OF THE TOP BAND, where a
 * horizontal rule puts none.
 *
 * DEFECT 2 — `halftone replace` clearing the whole buffer
 * ------------------------------------------------------
 * `img.data.fill(0)` erased every pixel of the buffer, not the layer's own ink, so a
 * screened element punched a transparent hole through the layers beneath it — and
 * through the paper ground. The signature is a region that SHOULD be opaque paper
 * coming out transparent.
 *
 * Run: node test/render-regressions.mjs
 */
import { createCanvas } from '@napi-rs/canvas'
import { renderScene } from '../src/render.mjs'

let failed = 0
let checks = 0
function check(label, ok, detail) {
  checks++
  if (ok) console.log(`  ok    ${label}${detail === undefined ? '' : '  — ' + detail}`)
  else { failed++; console.log(`  FAIL  ${label}${detail === undefined ? '' : '  — ' + detail}`) }
}

/**
 * Ink coverage of a region: the share of pixels that differ from the paper.
 *
 * Not "opacity" — the ground is opaque everywhere, so an opacity test reports 100%
 * for an empty corner and cannot see a stray line at all. That mistake made two
 * assertions here fail against a correct renderer.
 */
function region(canvas, x0, y0, x1, y1, paper = [255, 255, 255]) {
  const g = canvas.getContext('2d')
  const d = g.getImageData(0, 0, canvas.width, canvas.height).data
  let inked = 0
  let total = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * canvas.width + x) * 4
      const diff = Math.abs(d[i] - paper[0]) + Math.abs(d[i + 1] - paper[1]) + Math.abs(d[i + 2] - paper[2])
      if (diff > 24) inked++
      total++
    }
  }
  return inked / total
}

const W = 800
const H = 500

// ── defect 1 ────────────────────────────────────────────────────────────────
console.log('=== 1. a line must not be drawn from the canvas corner ===')

// The wrong form must be REFUSED, not silently drawn somewhere else. A guard that
// only warns would leave the same trap in place.
{
  // The renderer deliberately fails ONE LAYER rather than aborting the scene, and
  // records that in the log and the warnings. So "refused" means the layer reports an
  // error and NOTHING is drawn for it — not that the call throws. Asserting a throw
  // tested the harness rather than the guard.
  const out = await renderScene({
    canvas: { width: W, height: H },
    layers: [{ id: 'r', shape: 'line', x: 96, y: 153, x2: 704, y2: 153, stroke: '#000000', width: 2 }],
  }, { baseDir: process.cwd() })
  const entry = out.report.log.find((e) => e.id === 'r')
  check('a line using x/y instead of x1/y1 fails its layer', entry?.step === 'error',
    entry?.step === 'error' ? String(entry.message).slice(0, 70) + '…' : 'step=' + entry?.step)
  const warned = out.report.warnings.some((w) => /sets x\/y/.test(w))
  check('and the warning names the mistake', warned, out.report.warnings[0]?.slice(0, 70) ?? 'no warning')
  const drawn = region(out.canvas, 0, 0, W, H)
  check('and nothing is drawn for it', drawn === 0, (drawn * 100).toFixed(1) + '% inked')
}

// The correct form must be a horizontal rule at y=153 and put NO ink in the top-left
// corner. That corner is the defect's signature: a corner-anchored diagonal passes
// through it.
{
  // No ground: an un-inked corner must be fully transparent, which is the clearest
  // possible statement of "nothing was drawn there".
  const out = await renderScene({
    canvas: { width: W, height: H },
    layers: [{ id: 'r', shape: 'line', x1: 96, y1: 153, x2: 704, y2: 153, stroke: '#000000', width: 2 }],
  }, { baseDir: process.cwd() })
  const corner = region(out.canvas, 0, 0, 90, 90)
  check('a horizontal rule leaves the top-left corner empty', corner === 0, `${(corner * 100).toFixed(1)}% inked`)
  // And it must actually be drawn along its own row.
  // A 2px rule sampled over a 4-row band covers about half of it, so the threshold
  // reflects the line's width rather than assuming it fills the band.
  const onRule = region(out.canvas, 96, 151, 704, 155)
  check('the rule is drawn along y=153', onRule > 0.4, `${(onRule * 100).toFixed(1)}% inked in a 4-row band`)
}

// A genuine diagonal must still work, so the guard has not forbidden the feature.
{
  const out = await renderScene({
    canvas: { width: W, height: H },
    layers: [{ id: 'd', shape: 'line', x1: 0, y1: 0, x2: W, y2: H, stroke: '#000000', width: 3 }],
  }, { baseDir: process.cwd() })
  const corner = region(out.canvas, 0, 0, 60, 60)
  check('an explicit diagonal still draws from the corner', corner > 0.05, `${(corner * 100).toFixed(1)}% inked`)
}

// ── defect 2 ────────────────────────────────────────────────────────────────
console.log('\n=== 2. halftone replace must clear the LAYER, not the buffer ===')

// Ground plus a screened rect. The ground must survive everywhere the rect is not.
{
  const out = await renderScene({
    canvas: { width: W, height: H },
    ground: '#F1F1EC',
    layers: [
      { id: 'rect', shape: 'rect', x: 200, y: 150, w: 400, h: 200, paint: '#3E4650' },
      {
        id: 'screen', shape: 'rect', x: 200, y: 150, w: 400, h: 200, paint: '#3E4650',
        effects: [{ type: 'halftone', size: 12, angle: 22, tone: 'source', maxTone: 0.4, color: '#20241C', replace: true, respectAlpha: true }],
      },
    ],
  }, { baseDir: process.cwd() })

  // Well outside the rect: the paper ground must still be there. This is the exact
  // assertion that failed before the fix — that area came back fully transparent.
  const outside = region(out.canvas, 20, 20, 150, 120)
  check('the paper ground outside the screened rect survives', outside > 0.99, `${(outside * 100).toFixed(1)}% opaque`)

  // The other far corner too, so this cannot pass by the rect happening to sit in
  // one particular place.
  const outside2 = region(out.canvas, 620, 400, 780, 480)
  check('the ground on the opposite side survives', outside2 > 0.99, `${(outside2 * 100).toFixed(1)}% opaque`)

  const rec = out.report.log.find((e) => e.id === 'screen')
  const fx = rec?.drawn?.effects?.[0]
  check('the report says the screen replaced the layer', fx?.replace === true, JSON.stringify(fx ?? null))
  check('the report states how much of the silhouette survived',
    typeof fx?.silhouetteRetained === 'number' && fx.silhouetteRetained > 0,
    `silhouetteRetained=${fx?.silhouetteRetained}`)
}

// A screened layer with NO alpha of its own must produce nothing and say so, rather
// than reporting a healthy dot count for an invisible result.
{
  const out = await renderScene({
    canvas: { width: W, height: H },
    ground: '#FFFFFF',
    layers: [{
      id: 'invisible', shape: 'rect', x: 200, y: 150, w: 400, h: 200,
      paint: 'transparent',
      effects: [{ type: 'halftone', size: 12, angle: 22, color: '#20241C', replace: true, respectAlpha: true }],
    }],
  }, { baseDir: process.cwd() })
  const rec = out.report.log.find((e) => e.id === 'invisible')
  const fx = rec?.drawn?.effects?.[0]
  check('a screen on a layer with no ink reports an empty silhouette',
    fx?.silhouetteRetained === 0, `silhouetteRetained=${fx?.silhouetteRetained}, dots=${fx?.dots}`)
}

console.log(`\n=== ${checks - failed}/${checks} checks passed ===`)
process.exit(failed === 0 ? 0 : 1)
