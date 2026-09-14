/**
 * Regression tests for the `--scale` defect (and the scaling contract in general).
 *
 * THE DEFECT
 * ----------
 * `design render --scale <s>` rewrote `scene.canvas` and then walked the scene with
 * `Object.values`, which contains that same canvas — so `width`/`height` were
 * multiplied twice on the way out. The two axes did not even fail symmetrically:
 * the width was still large enough after the first multiply to be caught again,
 * while the rounded height had already fallen to 338 and failed the `> 1` test.
 *
 *   2400x1350 @ 0.5   ->    600x675   (intended 1200x675)   ratio 1.78 -> 0.89
 *   2400x1350 @ 0.25  ->    150x338   (intended  600x338)   ratio 1.78 -> 0.44
 *
 * The signature is therefore an ASPECT RATIO CHANGE, not a wrong pixel count. That
 * distinction matters: a test that only asserted "the canvas got smaller" passes
 * against the broken version. Every case below asserts the ratio is preserved.
 *
 * WHY IT WENT UNNOTICED
 * ---------------------
 * The render report and `verifyScene` both came back EMPTY — 0 errors, 0 warnings —
 * for a picture squashed to a quarter of its width, and `design_render` had never
 * been called with a `scale` in any recorded session. A clean report is not evidence
 * that this path works, which is why the contract is pinned here instead.
 *
 * Run: node test/scale.mjs
 */
import { readFileSync } from 'node:fs'
import { scaleScene } from '../src/scale.mjs'

let failed = 0
let checks = 0
function check(label, ok, detail) {
  checks++
  if (ok) console.log(`  ok    ${label}${detail === undefined ? '' : '  — ' + detail}`)
  else { failed++; console.log(`  FAIL  ${label}${detail === undefined ? '' : '  — ' + detail}`) }
}

const scene = () => ({ canvas: { width: 2400, height: 1350 }, layers: [] })

// ── 1. the defect's signature: the aspect ratio must survive ─────────────────
console.log('=== 1. scaling must preserve the aspect ratio ===')

for (const s of [0.5, 0.25, 0.2, 0.3, 0.1]) {
  const sc = scene()
  scaleScene(sc, s)
  const wantW = Math.round(2400 * s)
  const wantH = Math.round(1350 * s)
  const gotRatio = sc.canvas.width / sc.canvas.height
  const wantRatio = 2400 / 1350
  check(
    `scale ${s}: canvas is ${wantW}x${wantH}`,
    sc.canvas.width === wantW && sc.canvas.height === wantH,
    `got ${sc.canvas.width}x${sc.canvas.height} (ratio ${gotRatio.toFixed(3)} vs ${wantRatio.toFixed(3)})`,
  )
  // Independent of the exact numbers: the shape must not change. This is the
  // assertion the broken version fails even if the pixel arithmetic is edited.
  check(
    `scale ${s}: ratio within 1% of the original`,
    Math.abs(gotRatio - wantRatio) / wantRatio < 0.01,
    `ratio ${gotRatio.toFixed(4)}`,
  )
}

// A square must stay square — the clearest possible statement of the invariant,
// since any double-multiply of one axis shows up immediately.
{
  const sc = { canvas: { width: 1000, height: 1000 }, layers: [] }
  scaleScene(sc, 0.5)
  check('a square scene stays square', sc.canvas.width === sc.canvas.height,
    `${sc.canvas.width}x${sc.canvas.height}`)
}

// A portrait orientation must stay portrait (guards against a fix that hardcodes
// "width is the landscape axis").
{
  const sc = { canvas: { width: 1350, height: 2400 }, layers: [] }
  scaleScene(sc, 0.5)
  check('a portrait scene stays portrait', sc.canvas.height > sc.canvas.width,
    `${sc.canvas.width}x${sc.canvas.height}`)
}

// ── 2. a non-square canvas is where the defect was asymmetric ────────────────
console.log('\n=== 2. width and height must scale by the SAME factor ===')

{
  const sc = scene()
  scaleScene(sc, 0.25)
  const fw = sc.canvas.width / 2400
  const fh = sc.canvas.height / 1350
  check('both axes scaled by the same factor', Math.abs(fw - fh) < 0.005,
    `width x${fw.toFixed(4)}, height x${fh.toFixed(4)}`)
}

// ── 3. absolute lengths scale; fractional lengths do not ─────────────────────
console.log('\n=== 3. absolute lengths scale, fractional lengths are scale-invariant ===')

{
  // Both text conventions the real scenes use, and ONE size carrier each — see note below.
  const sc = {
    canvas: { width: 2400, height: 1350 },
    layers: [
      { id: 'abs', shape: 'rect', x: 100, y: 200, w: 400, h: 300 },
      { id: 'frac', shape: 'rect', x: 0.1, y: 0.2, w: 0.4, h: 0.3 },
      // Convention A: `font` is an OBJECT carrying its own size (muelsyse-ginkgo.json).
      { id: 'text-obj', shape: 'text', x: 120, y: 400, text: 'A', font: { family: ['Antiqua'], size: 200 } },
      // Convention B: `font` is a FAMILY STRING and the size is `layer.size`
      // (poster-a-flat.json). parseFontSpec() reads it as the default size.
      { id: 'text-str', shape: 'text', x: 120, y: 600, text: 'A', font: 'Grotesk', size: 214 },
    ],
  }
  scaleScene(sc, 0.5)
  const abs = sc.layers[0]
  const frac = sc.layers[1]
  check('absolute x/y/w/h halve', abs.x === 50 && abs.y === 100 && abs.w === 200 && abs.h === 150,
    `x=${abs.x} y=${abs.y} w=${abs.w} h=${abs.h}`)
  check('fractional x/y/w/h are untouched',
    frac.x === 0.1 && frac.y === 0.2 && frac.w === 0.4 && frac.h === 0.3,
    `x=${frac.x} y=${frac.y} w=${frac.w} h=${frac.h}`)
  check('an object font\'s size scales once', sc.layers[2].font.size === 100,
    `size=${sc.layers[2].font.size}`)
  check('a string font\'s layer.size scales once', sc.layers[3].size === 107,
    `size=${sc.layers[3].size}`)
}

// A size must be scaled EXACTLY ONCE, whichever carrier holds it. This is the general
// form of BOTH defects: each was a value reached by two code paths. `font.size` was hit
// by an explicit `font.size` branch AND by the walk over the layer's own values, so a
// 218px headline came out at 54px on a 0.5 draft. Real scenes state the size in exactly
// one place, but the invariant has to hold for the ones that use `font.size`, which is
// half of them.
{
  const sc = { canvas: { width: 2400, height: 1350 }, layers: [{ id: 'obj', shape: 'text', text: 'A', font: { family: ['Antiqua'], size: 218 } }] }
  scaleScene(sc, 0.5)
  check('an object font size is scaled exactly once, not twice',
    sc.layers[0].font.size === 109,
    `font.size=${sc.layers[0].font.size} (218 -> 109 expected, 54 was the defect)`)
}
{
  // Both carriers at once is malformed input, but it must still not double-scale either
  // one: a scene that states two sizes should scale both by s, not one by s and one by s².
  const sc = { canvas: { width: 2400, height: 1350 }, layers: [{ id: 'both', shape: 'text', text: 'A', font: { family: ['Antiqua'], size: 200 }, size: 200 }] }
  scaleScene(sc, 0.5)
  const l = sc.layers[0]
  check('two stated sizes each scale once',
    l.font.size === 100 && l.size === 100,
    `font.size=${l.font.size} layer.size=${l.size}`)
}

// A 1px hairline must survive as 1px: the `> 1` rule is deliberate, so a fix that
// switches to `>= 1` would collapse it to 0.5 and is caught here.
{
  const sc = { canvas: { width: 2400, height: 1350 }, layers: [{ id: 'hair', shape: 'line', width: 1, x1: 0, y1: 0, x2: 100, y2: 0 }] }
  scaleScene(sc, 0.5)
  check('a 1px width is left alone rather than scaled to 0.5', sc.layers[0].width === 1, `width=${sc.layers[0].width}`)
}

// ── 4. scale 1 is a no-op; the input is rejected, not silently accepted ──────
console.log('\n=== 4. edges ===')
{
  const sc = scene()
  const returned = scaleScene(sc, 1)
  check('scale 1 leaves the canvas alone', sc.canvas.width === 2400 && sc.canvas.height === 1350,
    `${sc.canvas.width}x${sc.canvas.height}`)
  check('scale 1 returns the scene for chaining', returned === sc, 'same object')
}
{
  let threw = false
  try { scaleScene(scene(), 0) } catch { threw = true }
  check('scale 0 is refused', threw, threw ? 'threw' : 'accepted')
}
{
  let threw = false
  try { scaleScene(scene(), -2) } catch { threw = true }
  check('a negative scale is refused', threw, threw ? 'threw' : 'accepted')
}

// ── 5. against the real poster scene the defect was found on ─────────────────
console.log('\n=== 5. the actual scene the defect was found on ===')
{
  const real = JSON.parse(readFileSync(new URL('../scenes/poster-a-flat.json', import.meta.url), 'utf8'))
  const original = { ...real.canvas }
  scaleScene(real, 0.25)
  const wantRatio = original.width / original.height
  const gotRatio = real.canvas.width / real.canvas.height
  check('poster-a-flat keeps its 16:9-ish proportion at 0.25',
    Math.abs(gotRatio - wantRatio) / wantRatio < 0.01,
    `${original.width}x${original.height} -> ${real.canvas.width}x${real.canvas.height} (ratio ${gotRatio.toFixed(3)})`)
  check('and it is the intended size', real.canvas.width === 600 && real.canvas.height === 338,
    `${real.canvas.width}x${real.canvas.height}`)
}

console.log(`\n=== ${checks - failed}/${checks} checks passed ===`)
process.exit(failed === 0 ? 0 : 1)
