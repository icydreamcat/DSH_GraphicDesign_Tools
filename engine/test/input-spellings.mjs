/**
 * Two inputs people actually write, and one vocabulary that has to refuse them when
 * they are wrong.
 *
 * WHY THESE LIVE TOGETHER
 * -----------------------
 * All three checks are about the same thing: a scene is written by hand, so the engine
 * must accept the spellings an author reaches for and must be LOUD about the ones it
 * cannot honour. The two defect classes here are opposite ends of that — a spelling the
 * engine should have accepted and did not (the layer simply vanished from the image),
 * and a spelling it should have refused and did not (an effect quietly composited as
 * something else). Both were found in real sessions and neither produced a warning.
 *
 * DEFECT 1 — a `path` layer written with the key `path`
 * -----------------------------------------------------
 * `{ shape: 'path', path: 'M 46 300 L 46 326 …' }` failed its layer with
 * "path needs a `d` string" and the mark was ABSENT from the finished image. The failure
 * was in `report.warnings`, which is not where anyone looks while looking at a picture:
 * the author looked at that render five times and never noticed the element was gone.
 * `d` is the SVG attribute name, but `path` is what a hand-written scene says — and the
 * engine already accepts `paint` and `color` for the same idea, so refusing this one was
 * an inconsistency, not a rule.
 *
 * DEFECT 2 — an effect's `blend` typo
 * -----------------------------------
 * `{ type: 'colorOverlay', blend: 'softLight' }` — the canvas mode being `soft-light`.
 * `overImage` in effects.mjs implements multiply and screen and falls through to normal
 * source-over for everything else, and nothing validated the mode, so the typo composited
 * as `normal` with no warning at all. Six texture layers were lost to that in one
 * session and the render still looked plausible. Layers were already guarded; effect
 * specs were not, so the two spellings of the same mistake behaved differently.
 *
 * Run: node test/input-spellings.mjs
 */
import { createCanvas } from '@napi-rs/canvas'
import { renderScene, BLEND_MODES, assertBlendMode } from '../src/render.mjs'
import { registerFonts, fontFamilyReport } from '../src/fonts.mjs'

let failed = 0
let checks = 0
function check(label, ok, detail) {
  checks++
  if (ok) console.log(`  ok    ${label}${detail === undefined ? '' : '  — ' + detail}`)
  else { failed++; console.log(`  FAIL  ${label}${detail === undefined ? '' : '  — ' + detail}`) }
}

const W = 120
const H = 120
const TRIANGLE = 'M 20 20 L 20 100 L 100 100 Z'

/** Pixels of one canvas that differ from another, so "nothing was drawn" is a number. */
function differingPixels(a, b) {
  const da = a.getContext('2d').getImageData(0, 0, a.width, a.height).data
  const db = b.getContext('2d').getImageData(0, 0, b.width, b.height).data
  let n = 0
  for (let i = 0; i < da.length; i += 4) {
    if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2] || da[i + 3] !== db[i + 3]) n++
  }
  return n
}

/** The RGB at one pixel of a rendered canvas. */
function pixelAt(canvas, x, y) {
  const d = canvas.getContext('2d').getImageData(x, y, 1, 1).data
  return [d[0], d[1], d[2], d[3]]
}

const scene = (layers) => renderScene({ canvas: { width: W, height: H }, layers }, { baseDir: process.cwd() })

// ── 1. a path layer accepts `d` and `path` ──────────────────────────────────
console.log('=== 1. a path layer accepts both spellings of its SVG data ===')

const empty = createCanvas(W, H)

{
  const withD = await scene([{ id: 'by-d', shape: 'path', d: TRIANGLE, paint: '#12161B' }])
  check('`d` still draws', differingPixels(empty, withD.canvas) > 0,
    `${differingPixels(empty, withD.canvas)} px drawn`)

  const withPath = await scene([{ id: 'by-path', shape: 'path', path: TRIANGLE, paint: '#12161B' }])
  const drawn = differingPixels(empty, withPath.canvas)
  check('`path` draws the same mark instead of failing the layer', drawn > 0, `${drawn} px drawn`)
  check('and the two spellings produce the same image', differingPixels(withD.canvas, withPath.canvas) === 0)
  check('and the `path` spelling raises no warning', withPath.report.warnings.length === 0,
    JSON.stringify(withPath.report.warnings))

  // The draw record is what lands in the report log. A normalisation has to be visible
  // there, otherwise the report is describing a layer that was not the one written.
  const rec = withPath.report.log.find((e) => e.id === 'by-path')
  check('the report records that the key was `path`', rec?.drawn?.dFrom === 'path',
    JSON.stringify(rec?.drawn ?? null))
  const recD = withD.report.log.find((e) => e.id === 'by-d')
  check('and says nothing extra when the key was already `d`', recD?.drawn?.dFrom === undefined,
    JSON.stringify(recD?.drawn ?? null))
}

// `d` wins when both are present, and that is a decision rather than an accident: `d` is
// the canonical name, so a scene that carries both is normalised from the canonical one.
{
  const both = await scene([{ id: 'both', shape: 'path', d: TRIANGLE, path: 'M 0 0 L 0 1 L 1 1 Z', paint: '#12161B' }])
  const rec = both.report.log.find((e) => e.id === 'both')
  check('when both keys are present, `d` wins and nothing is normalised',
    rec?.drawn?.dFrom === undefined && rec?.drawn?.path === TRIANGLE, JSON.stringify(rec?.drawn ?? null))
}

// Neither key is a string: still a failed layer, and now the message names both keys so
// the next person does not have to read the renderer to find out what it wanted.
{
  const missing = await scene([{ id: 'no-data', shape: 'path', paint: '#12161B' }])
  const rec = missing.report.log.find((e) => e.id === 'no-data')
  check('a path layer with neither key still fails', rec?.step === 'error', JSON.stringify(rec ?? null))
  check('and the message names both accepted keys',
    typeof rec?.message === 'string' && rec.message.includes('`d`') && rec.message.includes('`path`'),
    String(rec?.message))
  const warned = missing.report.warnings.some((w) => /path needs/.test(w))
  check('and it reaches the warnings list, where a failure is actually read', warned,
    JSON.stringify(missing.report.warnings))
}

// `path` must keep meaning what it means on a TEXT layer, which is text on a path.
// Accepting the key on shape layers must not have taken that over.
{
  registerFonts()
  const faces = fontFamilyReport().faces
  if (faces.length === 0) {
    console.log('  skip  no curated fonts resolved on this machine — text-on-path cannot run')
  } else {
    const onPath = await scene([{
      id: 'text-on-path', shape: 'text', text: 'straight', size: 20, font: faces[0].alias,
      path: { type: 'arc', cx: 60, cy: 130, r: 70, startAngle: -Math.PI / 2 },
    }])
    const rec = onPath.report.log.find((e) => e.id === 'text-on-path')
    check('a text layer still reads `path` as text-on-a-path', rec?.drawn?.mode === 'path',
      JSON.stringify(rec?.drawn ?? null))
  }
}

// ── 2. an effect's blend mode is validated, not silently ignored ────────────
console.log('\n=== 2. an effect spec\'s blend mode is checked, not ignored ===')

{
  const layers = (blend) => [
    { id: 'base', shape: 'rect', x: 0, y: 0, w: W, h: H, paint: '#808080' },
    { id: 'tex', shape: 'rect', x: 20, y: 20, w: 80, h: 80, paint: '#404040', effects: [{ type: 'colorOverlay', color: '#FFFFFF', opacity: 1, blend }] },
  ]
  const normal = await scene(layers('normal'))
  const typo = await scene(layers('softLight'))
  const multiplied = await scene(layers('multiply'))
  const baseOnly = await scene([layers('normal')[0]])

  // The defect's signature, measured. Before the guard, `normal` and the typo differed
  // by ZERO pixels: the typo composited as source-over, which is what `normal` means.
  const typoLooksNormal = differingPixels(normal.canvas, typo.canvas) === 0
  check('the typo no longer renders as `normal`', !typoLooksNormal,
    `${differingPixels(normal.canvas, typo.canvas)} px differ from the normal blend`)

  const rec = typo.report.log.find((e) => e.id === 'tex')
  check('the offending layer is recorded as an error', rec?.step === 'error', JSON.stringify(rec ?? null))
  check('the warning names the offending value and the accepted ones',
    typo.report.warnings.some((w) => w.includes('softLight') && w.includes('soft-light')),
    JSON.stringify(typo.report.warnings))

  // The layer is given up rather than drawn with a mode it was not asked for, and what
  // is given up is only THAT layer: the ground beneath it survives untouched. Stated as
  // a measurement because it is the cost of the guard, not a side detail.
  check('only the refused layer is lost — the ground under it is untouched',
    differingPixels(baseOnly.canvas, typo.canvas) === 0,
    `${differingPixels(baseOnly.canvas, typo.canvas)} px differ from the ground alone`)

  // The modes that were never the problem must keep working, so this guard has not
  // forbidden the feature. `multiply` is implemented by `overImage` and comes out dark.
  const centre = pixelAt(multiplied.canvas, 60, 60)
  check('a real mode still composites — multiply darkens the overlap', centre[0] < 140, `centre ${centre.join(',')}`)
  const centreNormal = pixelAt(normal.canvas, 60, 60)
  check('and normal still replaces', centreNormal[0] > 240, `centre ${centreNormal.join(',')}`)
}

// A typo in an effect that gets it right elsewhere must not be excused: `outerGlow`
// defaults to `screen`, and the default is what a broken spec falls back to.
{
  const out = await scene([
    { id: 'base', shape: 'rect', x: 0, y: 0, w: W, h: H, paint: '#808080' },
    {
      id: 'glow', shape: 'rect', x: 30, y: 30, w: 60, h: 60, paint: '#404040',
      effects: [{ type: 'outerGlow', color: '#FFFFFF', opacity: 1, size: 4, blend: 'scren' }],
    },
  ])
  const rec = out.report.log.find((e) => e.id === 'glow')
  check('a typo in any layer effect is caught, defaults included', rec?.step === 'error', JSON.stringify(rec ?? null))
  check('and the glow layer reports the typo rather than the default',
    out.report.warnings.some((w) => w.includes('"scren"')), JSON.stringify(out.report.warnings))
}

// ── 3. one vocabulary, one message, both paths ─────────────────────────────
console.log('\n=== 3. the layer path and the effect path share one vocabulary ===')

{
  check('the vocabulary is Photoshop\'s set', BLEND_MODES.size === 16 && BLEND_MODES.has('soft-light'),
    `${BLEND_MODES.size} modes`)
  check('normal maps to the canvas default', assertBlendMode('normal') === 'source-over')
  check('a real mode passes through unchanged', assertBlendMode('multiply') === 'multiply')
  check('an absent mode is allowed — `blend` is optional', assertBlendMode(undefined) === 'source-over' && assertBlendMode(null) === 'source-over')

  let layerError = null
  try { assertBlendMode('softLight') } catch (e) { layerError = e.message }
  check('an unknown mode throws', layerError !== null, String(layerError))

  // The same typo on a LAYER, so the two paths can be compared directly instead of
  // assumed to agree.
  const out = await scene([
    { id: 'base', shape: 'rect', x: 0, y: 0, w: W, h: H, paint: '#808080' },
    { id: 'bad-blend', shape: 'rect', x: 0, y: 0, w: 40, h: 40, paint: '#000000', blend: 'softLight' },
  ])
  const layerWarn = out.report.warnings.find((w) => w.includes('softLight'))
  check('a layer with the same typo produces the same message',
    typeof layerWarn === 'string' && layerWarn.includes(layerError),
    JSON.stringify(layerWarn ?? null))
}

console.log(`\n=== ${checks - failed}/${checks} checks passed ===`)
process.exit(failed === 0 ? 0 : 1)
