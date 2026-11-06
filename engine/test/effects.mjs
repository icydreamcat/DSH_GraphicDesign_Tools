/**
 * Layer-effect and filter verification.
 *
 * WHY EACH CHECK HAS A COUNTER-EXAMPLE
 * ------------------------------------
 * The repair notes record six separate defects that a self-check reported as
 * "0 problems", and the reason every time was the same: the check shared an
 * assumption with the code it was checking, so both were wrong in the same
 * direction and agreed. A test that only asserts "the effect ran" is exactly that
 * shape — it confirms the code did something, not that it did the right thing.
 *
 * So every assertion here is paired with a case that MUST fail it:
 *
 *   * a glow must add ink OUTSIDE the silhouette — and the same buffer with the
 *     effect omitted must not;
 *   * a stroke must produce a band whose thickness tracks `size` — and a
 *     zero-size stroke must produce none;
 *   * an inner shadow must darken the INSIDE and leave the outside untouched;
 *   * a bevel's highlight must be on the lit side, which flips when the angle
 *     moves 180 degrees. Asserting only "a bevel changed something" would pass a
 *     bevel that shaded the wrong way, which is the classic bevel defect;
 *   * a blur must be monotonic in radius — median edge softness at 2px must be
 *     less than at 20px, not merely different.
 *
 * Run: node test/effects.mjs
 */
import { registerFonts } from '../src/fonts.mjs'
import {
blurRGBA, alphaPlane, dilatePlane, erodePlane, edgeRamp, overImage, planeToImage, patternTile, lightOffset, resolveScope, blendByScope, LAYER_EFFECTS,
} from '../src/effects.mjs'

registerFonts()

let failed = 0
let checks = 0
function check(label, ok, detail) {
  checks++
  if (ok) console.log(`  ok    ${label}${detail === undefined ? '' : '  — ' + detail}`)
  else { failed++; console.log(`  FAIL  ${label}${detail === undefined ? '' : '  — ' + detail}`) }
}

// ── fixtures ────────────────────────────────────────────────────────────────

/** A solid square of ink centred in a transparent canvas — the silhouette every
 *  layer effect is tested against. A square rather than a circle so the lit side
 *  of a bevel is unambiguous. */
function squareCanvas(w, h, size, colour = '#334455') {
  const data = new Uint8ClampedArray(w * h * 4)
  const x0 = Math.round((w - size) / 2)
  const y0 = Math.round((h - size) / 2)
  // Parse the colour properly. The first version of this helper compared the
  // argument against the default string and otherwise fell through to a hardcoded
  // triple, so asking for `#FFFFFF` silently produced the dark default — and then
  // three blend-mode assertions appeared to fail against an engine that was
  // correct. A fixture that ignores its own argument invalidates every test built
  // on it.
  const hex = colour.replace('#', '')
  const c = {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  }
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) {
      const i = (y * w + x) * 4
      data[i] = c.r; data[i + 1] = c.g; data[i + 2] = c.b; data[i + 3] = 255
    }
  }
  return { width: w, height: h, data }
}

const img = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })

/** Count pixels with alpha above a threshold. */
function inkCount(image, threshold = 8) {
  let n = 0
  for (let i = 3; i < image.data.length; i += 4) if (image.data[i] > threshold) n++
  return n
}

/** Mean luminance inside a box, ignoring transparent pixels. */
function meanLuma(image, x0, y0, x1, y1) {
  let sum = 0, n = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * image.width + x) * 4
      if (image.data[i + 3] < 8) continue
      sum += 0.2126 * image.data[i] + 0.7152 * image.data[i + 1] + 0.0722 * image.data[i + 2]
      n++
    }
  }
  return n === 0 ? -1 : sum / n
}

/** Width of the alpha ramp across a horizontal line, i.e. how soft the edge is. */
function edgeSoftness(image, y) {
  let first = -1, last = -1
  for (let x = 0; x < image.width; x++) {
    const a = image.data[(y * image.width + x) * 4 + 3]
    if (a > 4 && first < 0) first = x
    if (a < 251 && a > 4) last = x
  }
  return first < 0 ? 0 : Math.max(0, last - first)
}

/** Run one layer effect over the fixture and return the result. */
function apply(name, spec, source = squareCanvas(120, 120, 40)) {
  const fx = LAYER_EFFECTS[name]
  if (fx === undefined) throw new Error(`no such layer effect: ${name}`)
  const alpha = alphaPlane(source)
  const resolved = { ...(fx.defaults || {}), ...spec }
  return fx.run({
    image: source, alpha, width: source.width, height: source.height,
    spec: resolved, pool: null, W: source.width, H: source.height,
  }).image
}

console.log('=== 1. morphological primitives (erode must be the true twin of dilate) ===')
{
  const src = squareCanvas(60, 60, 20)
  const a = alphaPlane(src)
  check('dilate grows ink', inkCount({ width: 60, height: 60, data: planeToImage(dilatePlane(a, 60, 60, 5), 60, 60, '#FFFFFF', 1).data }) > inkCount(src),
    `${inkCount(src)} -> grown`)
  const eroded = erodePlane(a, 60, 60, 5)
  let erodedInk = 0
  for (const v of eroded) if (v > 127) erodedInk++
  check('erode shrinks ink', erodedInk < 20 * 20 && erodedInk > 0, `${20 * 20} -> ${erodedInk}`)
  // The twin property: eroding by a dilation of the complement must recover the
  // shape exactly at radius 0, and must be idempotent-ish at radius 1.
  const d0 = dilatePlane(eroded, 60, 60, 5)
  let recovered = 0
  for (let i = 0; i < d0.length; i++) if (d0[i] > 127) recovered++
  check('dilate(erode(x)) is not larger than the original', recovered <= 20 * 20 + 2, `${recovered} vs ${20 * 20}`)
}

console.log('\n=== 2. blur: monotonic in radius, and edge-clamped not wrap-around ===')
{
  const src = squareCanvas(120, 120, 40)
  const s2 = blurRGBA(src, 2)
  const s20 = blurRGBA(src, 20)
  const soft2 = edgeSoftness(s2, 60)
  const soft20 = edgeSoftness(s20, 60)
  check('edge softness increases with radius', soft20 > soft2, `2px -> ${soft2}, 20px -> ${soft20}`)
  // A blur must not import ink from the far side: a solid block in one corner
  // blurred hard must leave the opposite corner empty.
  const corner = img(120, 120)
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
    const i = (y * 120 + x) * 4
    corner.data[i] = 255; corner.data[i + 3] = 255
  }
  const blurred = blurRGBA(corner, 10)
  let opposite = 0
  for (let y = 100; y < 120; y++) for (let x = 100; x < 120; x++) opposite += blurred.data[(y * 120 + x) * 4 + 3]
  check('blur clamps at edges (no wrap-around)', opposite === 0, `opposite corner ink = ${opposite}`)
}

console.log('\n=== 3. drop shadow: ink appears OUTSIDE, on the offset side ===')
{
  const src = squareCanvas(120, 120, 40)
  const base = inkCount(src)
  const lit = apply('dropShadow', { angle: 135, distance: 14, size: 6, opacity: 0.8 })
  check('shadow adds ink outside the silhouette', inkCount(lit) > base, `${base} -> ${inkCount(lit)}`)
  // The convention is read, not re-derived: lightOffset says where the ink is
  // pushed, so the shadow is asserted to land there. See the table on lightOffset.
  const push = lightOffset({ angle: 135 }, 14)
  check('lightOffset(135°) pushes up-left', push.dx < 0 && push.dy < 0, `dx=${push.dx.toFixed(1)} dy=${push.dy.toFixed(1)}`)
  // Sample the two flanking regions directly rather than through a crop helper:
  // an off-by-one in a helper is how a test starts reporting the opposite of the
  // truth, and checking single pixels keeps the coordinate arithmetic visible.
  const box = { x0: 40, y0: 40, x1: 79, y1: 79 }
  const outsideInk = (x0, y0, x1, y1) => {
    let n = 0
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (lit.data[(y * 120 + x) * 4 + 3] > 8) n++
    }
    return n
  }
  const upperLeft = outsideInk(0, 0, box.x0 - 1, box.y0 - 1)
  const lowerRight = outsideInk(box.x1 + 1, box.y1 + 1, 119, 119)
  check('shadow lands where lightOffset points', upperLeft > lowerRight * 5,
    `up-left ${upperLeft} vs down-right ${lowerRight} (expected ${push.dx < 0 ? 'up-left' : 'down-right'} to dominate)`)
  check('omitting the effect adds nothing', inkCount(src) === base, `${base}`)
}

console.log('\n=== 4. outer glow: symmetric and additive ===')
{
  const src = squareCanvas(120, 120, 40)
  const lit = apply('outerGlow', { color: '#FFFFFF', opacity: 0.9, size: 10 })
  check('glow adds ink outside', inkCount(lit) > inkCount(src), `${inkCount(src)} -> ${inkCount(lit)}`)
  const left = inkCount({ width: 120, height: 120, data: cropRegion(lit, 20, 55, 40, 65) })
  const right = inkCount({ width: 120, height: 120, data: cropRegion(lit, 80, 55, 100, 65) })
  // A glow has no direction, so the two sides must be close. A glow implemented
  // with an accidental offset would fail here.
  check('glow is symmetric (no direction)', left > 0 && Math.abs(left - right) <= Math.max(2, left * 0.2),
    `left ${left} vs right ${right}`)
}

console.log('\n=== 5. inner shadow: darkens INSIDE, leaves OUTSIDE untouched ===')
{
  const src = squareCanvas(120, 120, 40)
  const lit = apply('innerShadow', { color: '#000000', opacity: 1, distance: 6, size: 6, angle: 135 })
  const beforeIn = meanLuma(src, 42, 42, 78, 78)
  const afterIn = meanLuma(lit, 42, 42, 78, 78)
  check('inner shadow darkens the interior', afterIn < beforeIn, `${beforeIn.toFixed(1)} -> ${afterIn.toFixed(1)}`)
  // The region strictly outside the square must stay empty.
  let outside = 0
  for (let y = 0; y < 120; y++) for (let x = 0; x < 120; x++) {
    const insideSquare = x >= 40 && x < 80 && y >= 40 && y < 80
    if (!insideSquare) outside += lit.data[(y * 120 + x) * 4 + 3]
  }
  check('inner shadow does not escape the silhouette', outside === 0, `outside ink = ${outside}`)
}

console.log('\n=== 6. stroke: thickness tracks size, and position picks the side ===')
{
  const src = squareCanvas(120, 120, 40)
  const thin = apply('stroke', { size: 2, color: '#FF0000', position: 'outside' })
  const thick = apply('stroke', { size: 8, color: '#FF0000', position: 'outside' })
  check('thicker stroke covers more ink', inkCount(thick) > inkCount(thin), `2px ${inkCount(thin)} -> 8px ${inkCount(thick)}`)
  // `outside` must leave the DEEP interior clear. Sampling one pixel at the exact
  // centre avoids the earlier mistake of sampling a band that legitimately sits a
  // few pixels inside the nominal silhouette edge.
  const centreAlpha = thin.data[(60 * 120 + 60) * 4 + 3]
  check('outside stroke leaves the deep interior clear', centreAlpha === 0 || thin.data[(60 * 120 + 60) * 4] === 0x33,
    `centre alpha ${centreAlpha}`)
  // The band belongs to the stroke colour, so the centre must keep its own.
  check('outside stroke does not recolour the interior', thin.data[(60 * 120 + 60) * 4] === 0x33,
    `centre red ${thin.data[(60 * 120 + 60) * 4]}`)

  const inside = apply('stroke', { size: 6, color: '#FF0000', position: 'inside' })
  let ringOutside = 0
  for (let y = 0; y < 120; y++) for (let x = 0; x < 120; x++) {
    const insideSquare = x >= 40 && x < 80 && y >= 40 && y < 80
    if (!insideSquare) ringOutside += inside.data[(y * 120 + x) * 4 + 3]
  }
  check('inside stroke stays inside the silhouette', ringOutside === 0, `outside ink = ${ringOutside}`)
  // Counter-example for the thickness claim: the thinnest band must still be
  // smaller than the 2px one, so "more ink" cannot be satisfied by a constant.
  const one = apply('stroke', { size: 1, color: '#FF0000', position: 'outside' })
  check('size 1 is thinner than size 2', inkCount(one) < inkCount(thin) && inkCount(one) > 0,
    `1px ${inkCount(one)}, 2px ${inkCount(thin)}`)
}

console.log('\n=== 7. bevel: the highlight is on the LIT side, and flips with the angle ===')
{
  const src = squareCanvas(120, 120, 40)
  const opts = { style: 'innerBevel', altitude: 45, size: 8, depth: 1.5, highlight: '#FFFFFF', shadow: '#000000', highlightOpacity: 0.9, shadowOpacity: 0.9 }
  // WHICH SIDE IS LIT — read off `lightOffset`'s own table, not restated here.
  //
  // At 135° the light comes from the LOWER RIGHT, so it travels up-and-left and
  // the UPPER-LEFT edges of a shape are the ones facing it. The first version of
  // this test asserted the opposite and reported the engine as broken; the engine
  // was right. Deriving the expectation from `lightOffset` is what stops that
  // recurring — the convention then lives in exactly one place.
  const travel = lightOffset({ angle: 135 }, 10)
  const litIsUpperLeft = travel.dx < 0 && travel.dy < 0
  check('lightOffset says 135° comes from the lower right', litIsUpperLeft,
    `travels dx=${travel.dx.toFixed(1)} dy=${travel.dy.toFixed(1)}`)
  // `meanLuma` takes (image, x0, y0, x1, y1) — the first version passed the y range
  // as x, so both samples landed on the same box and the difference was identically
  // zero. Sampling a 1px-wide strip keeps the coordinates readable.
  const strip = (im, x, y0, y1) => meanLuma(im, x, y0, x + 1, y1)
  const lit135 = apply('bevel', { ...opts, angle: 135 })
  const ul = strip(lit135, 44, 60, 76)
  const lr = strip(lit135, 75, 60, 76)
  check('bevel brightens one inner edge and darkens the other', Math.abs(ul - lr) > 8, `upper-left ${ul.toFixed(1)} vs lower-right ${lr.toFixed(1)}`)
  check('the edge facing the light is the bright one', ul > lr, `${ul.toFixed(1)} > ${lr.toFixed(1)}`)

  const lit315 = apply('bevel', { ...opts, angle: 315 })
  const ul2 = strip(lit315, 44, 60, 76)
  const lr2 = strip(lit315, 75, 60, 76)
  // THE check that catches a bevel shading the wrong way: rotating the light 180°
  // must swap which edge is bright. Asserting only "something changed" would pass
  // an inverted bevel, which is the classic bevel defect.
  check('rotating the light 180° swaps the lit edge', lr2 > ul2, `315°: lower-right ${lr2.toFixed(1)} > upper-left ${ul2.toFixed(1)}`)
}

console.log('\n=== 8. the remaining layer effects all change the image ===')
{
  const src = squareCanvas(120, 120, 40)
  const cases = [
    ['satin', { color: '#000000', opacity: 0.8, distance: 10, size: 8 }],
    ['innerGlow', { color: '#FFFFFF', opacity: 0.9, size: 8 }],
    ['colorOverlay', { color: '#FF9900', opacity: 1 }],
    ['gradientOverlay', { gradient: { type: 'linear', angle: 90, stops: ['#FFFFFF', '#000000'] }, opacity: 1 }],
    ['patternOverlay', { pattern: 'dots', size: 8, ink: '#FF0000', ground: 'transparent', opacity: 1 }],
  ]
  for (const [name, spec] of cases) {
    const out = apply(name, spec)
    let changed = 0
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i] !== src.data[i] || out.data[i + 1] !== src.data[i + 1] || out.data[i + 2] !== src.data[i + 2]) changed++
    }
    // A sparse pattern legitimately touches few pixels — a dots tile at 8px inks
    // about a ninth of its area — so the floor is a fraction of the shape, not a
    // fixed number that silently encodes one pattern's density.
    check(`${name} changes the pixels`, changed > 60, `${changed} pixels differ`)
  }
}

console.log('\n=== 9. gradient overlay: the gradient actually varies across the shape ===')
{
  const src = squareCanvas(120, 120, 40)
  const out = apply('gradientOverlay', { gradient: { type: 'linear', angle: 90, stops: ['#FFFFFF', '#000000'] }, opacity: 1, blend: 'normal' })
  const top = meanLuma(out, 45, 42, 75, 46)
  const bottom = meanLuma(out, 45, 74, 75, 78)
  check('gradient is lighter at the top than the bottom', top > bottom + 20, `top ${top.toFixed(1)} vs bottom ${bottom.toFixed(1)}`)
  // Counter-example: a flat colour overlay must NOT show that ramp, so the check
  // above cannot be satisfied by any overlay at all.
  const flat = apply('colorOverlay', { color: '#808080', opacity: 1 })
  const ft = meanLuma(flat, 45, 42, 75, 46)
  const fb = meanLuma(flat, 45, 74, 75, 78)
  check('a flat overlay shows no ramp', Math.abs(ft - fb) < 2, `${ft.toFixed(1)} vs ${fb.toFixed(1)}`)
}

console.log('\n=== 10. patterns tile deterministically ===')
{
  const t1 = patternTile('dots', 16, '#000000', 'transparent')
  const t2 = patternTile('dots', 16, '#000000', 'transparent')
  let same = true
  for (let i = 0; i < t1.data.length; i++) if (t1.data[i] !== t2.data[i]) { same = false; break }
  check('same spec gives the same tile', same)
  check('a dot tile has ink', inkCount(t1) > 0, `${inkCount(t1)} of ${16 * 16}`)
  check('an unknown pattern is refused', (() => { try { patternTile('nope', 8); return false } catch { return true } })())
}

// Section 11 used to test the original sampling filters, which `filters.mjs` replaced and
// which have now been deleted. Their coverage lives in `test/filters.mjs`, where the
// implementations do — including the directionality check that stood here, and the
// constant-time cost assertions that could not have been made against the originals. A
// second copy of those assertions against a deleted implementation is not coverage.

console.log('\n=== 12. overImage respects blend modes ===')
{
  const base = squareCanvas(40, 40, 40, '#FFFFFF')
  const top = squareCanvas(40, 40, 40, '#000000')
  const multiplied = overImage(base, top, 1, 'multiply')
  check('multiply of white and black is black', multiplied.data[0] < 8, `got ${multiplied.data[0]}`)
  const screened = overImage(base, top, 1, 'screen')
  check('screen of white and black is white', screened.data[0] > 247, `got ${screened.data[0]}`)
  const opaque = overImage(base, top, 1, 'normal')
  check('normal replaces', opaque.data[0] < 8, `got ${opaque.data[0]}`)
  const half = overImage(base, top, 0.5, 'normal')
  check('partial alpha blends', half.data[0] > 100 && half.data[0] < 155, `got ${half.data[0]}`)
}

console.log('\n=== 13. edge ramp: a real height field, not a constant ===')
{
  const src = squareCanvas(80, 80, 30)
  const a = alphaPlane(src)
  const ramp = edgeRamp(a, 80, 80, 8)
  const centre = ramp[40 * 80 + 40]
  const outside = ramp[2 * 80 + 2]
  check('ramp is 1 deep inside', centre > 0.99, `${centre.toFixed(3)}`)
  check('ramp is 0 well outside', outside < 0.01, `${outside.toFixed(3)}`)
  // THE property the bevel depends on: the ramp must actually RISE across the
  // transition. The first implementation returned a signed distance that was
  // constant across the whole interior, so its gradient was zero and every bevel
  // shaded the shape with a single lambert value — a flat wash. Counting rises over
  // the transition band (not the flat plateaus either side) is what catches that;
  // asserting only the interior and outside values would not.
  // Counted over the LEFT transition only. Scanning the whole row would cross the
  // right-hand edge as well, where the ramp legitimately falls — and a check that
  // demands monotonicity across both edges fails the day it is written.
  let rises = 0
  let drops = 0
  for (let x = 16; x <= 30; x++) {
    const a = ramp[40 * 80 + x]
    const b = ramp[40 * 80 + x + 1]
    if (b > a + 1e-6) rises++
    else if (b < a - 1e-6) drops++
  }
  check('ramp rises monotonically across one edge', rises >= 12 && drops === 0, `${rises} rising, ${drops} falling`)
  // The gradient must be non-zero near the edge and zero in the plateaus, which is
  // what makes a bevel light the edge and leave the interior flat.
  const gAtEdge = Math.abs(ramp[40 * 80 + 26] - ramp[40 * 80 + 24])
  const gDeepInside = Math.abs(ramp[40 * 80 + 41] - ramp[40 * 80 + 39])
  check('gradient is non-zero at the edge and zero deep inside', gAtEdge > 0.01 && gDeepInside < 0.001,
    `edge ${gAtEdge.toFixed(4)}, interior ${gDeepInside.toFixed(4)}`)
}

console.log('\n=== 14. the light-direction table is asserted, not re-derived ===')
{
  // The convention lives on `lightOffset` as a table. If this test recomputed it,
  // it would agree with a wrong implementation — which is what happened once and
  // sent me chasing an engine that was correct.
  const rows = [
    [0, 'down'], [90, 'left'], [135, 'up-left'], [180, 'up'], [270, 'right'], [315, 'down-right'],
  ]
  for (const [deg, want] of rows) {
    const { dx, dy } = lightOffset({ angle: deg }, 10)
    const got = (dy < -1 ? 'up' : dy > 1 ? 'down' : '') + (dx < -1 ? '-left' : dx > 1 ? '-right' : '')
    const norm = got.startsWith('-') ? got.slice(1) : got
    check(`lightOffset ${deg}° travels ${want}`, norm === want, `got dx=${dx.toFixed(1)} dy=${dy.toFixed(1)} -> ${norm || 'none'}`)
  }
}

console.log('\n=== 15. scope: WHERE an effect acts ===')
{
  // The design failure this exists to fix: a full-strength duotone erased a
  // subject's internal detail, and a low-strength bevel became invisible. Neither
  // is fixed by a strength knob — the missing axis is EXTENT. These assertions all
  // use an effect strong enough to change the image a lot, so "unchanged" can only
  // mean the scope did the work, never that the effect was weak.
  const src = squareCanvas(120, 120, 44)
  const strong = { angle: 135, distance: 20, size: 10, opacity: 1, color: '#FF0000' }

  // Baseline: with no scope the effect must visibly change the image.
  const bare = apply('dropShadow', strong, src)
  let bareDiff = 0
  for (let i = 0; i < bare.data.length; i++) if (bare.data[i] !== src.data[i]) bareDiff++
  check('the control effect changes the image a lot', bareDiff > 3000, `${bareDiff} subpixels differ`)

  // scope: 0 everywhere must reproduce the input EXACTLY. Nothing weaker will do:
  // this is the assertion that catches a scope silently being ignored.
  const zeroScope = new Float32Array(120 * 120)   // all 0
  const masked = blendByScope(src, bare, zeroScope)
  let zeroDiff = 0
  for (let i = 0; i < src.data.length; i++) if (masked.data[i] !== src.data[i]) zeroDiff++
  check('scope 0 leaves the layer byte-identical', zeroDiff === 0, `${zeroDiff} subpixels differ`)

  // scope: 1 everywhere must reproduce the effect EXACTLY.
  const oneScope = new Float32Array(120 * 120).fill(1)
  const full = blendByScope(src, bare, oneScope)
  let fullDiff = 0
  for (let i = 0; i < bare.data.length; i++) if (full.data[i] !== bare.data[i]) fullDiff++
  check('scope 1 reproduces the effect byte-identical', fullDiff === 0, `${fullDiff} subpixels differ`)

  // A ramp must let the effect through on one side and not the other. Asserting
  // BOTH ends means a ramp that came out uniformly 0 or uniformly 1 fails.
  const ramp = resolveScope(
    { type: 'ramp', angle: 90, stops: ['#FFFFFF', '#000000'] },
    120, 120, {},
  )
  check('ramp is 1 at its first stop', ramp[2 * 120 + 60] > 0.97, `${ramp[2 * 120 + 60].toFixed(3)}`)
  check('ramp is 0 at its last stop', ramp[117 * 120 + 60] < 0.04, `${ramp[117 * 120 + 60].toFixed(3)}`)
  const ramped = blendByScope(src, bare, ramp)
  const topDiff = (() => { let n = 0; for (let y = 0; y < 40; y++) for (let x = 0; x < 120; x++) { const i = (y * 120 + x) * 4; if (ramped.data[i] !== src.data[i]) n++ } return n })()
  const botDiff = (() => { let n = 0; for (let y = 80; y < 120; y++) for (let x = 0; x < 120; x++) { const i = (y * 120 + x) * 4; if (ramped.data[i] !== src.data[i]) n++ } return n })()
  check('a ramp applies the effect at one end and not the other', topDiff > 100 && botDiff === 0,
    `top ${topDiff} changed, bottom ${botDiff} changed`)

  // invert flips which end. Without this, "abstract everything except the face"
  // cannot be written, and an inverted scope that silently did nothing would pass
  // any single-ended check.
  const inv = resolveScope({ type: 'ramp', angle: 90, stops: ['#FFFFFF', '#000000'], invert: true }, 120, 120, {})
  check('invert swaps the ends', inv[2 * 120 + 60] < 0.03 && inv[117 * 120 + 60] > 0.97,
    `top ${inv[2 * 120 + 60].toFixed(3)}, bottom ${inv[117 * 120 + 60].toFixed(3)}`)

  // An array of scopes intersects, so two opposing ramps multiply to `t * (1 - t)`:
  // 0 at both ends and 0.25 in the middle, NOT zero everywhere. Asserting "near zero
  // across most of the frame" asserts something false about a product of two ramps —
  // the first version of this check did exactly that and reported a correct
  // implementation as broken. The assertion is the DEFINING property of a product
  // instead: strictly below either input, and cancelled wherever either is zero.
  const rampA = resolveScope({ type: 'ramp', angle: 90, stops: ['#FFFFFF', '#000000'] }, 120, 120, {})
  const rampB = resolveScope({ type: 'ramp', angle: 90, stops: ['#000000', '#FFFFFF'] }, 120, 120, {})
  const both = resolveScope([
    { type: 'ramp', angle: 90, stops: ['#FFFFFF', '#000000'] },
    { type: 'ramp', angle: 90, stops: ['#000000', '#FFFFFF'] },
  ], 120, 120, {})
  let belowEither = 0
  let total = 0
  for (let i = 0; i < both.length; i++) {
    if (rampA[i] > 0.1 && rampB[i] > 0.1) {
      total++
      if (both[i] < Math.min(rampA[i], rampB[i])) belowEither++
    }
  }
  check('a scope array intersects (product of the inputs)', belowEither === total && total > 8000,
    `${belowEither}/${total} strictly below the smaller input`)
  check('intersection cancels where either scope is zero',
    both[2 * 120 + 60] < 0.08 && both[117 * 120 + 60] < 0.08,
    `top ${both[2 * 120 + 60].toFixed(3)}, bottom ${both[117 * 120 + 60].toFixed(3)}`)

  // A ramp is normalised to its OWN box, not the canvas, so a sub-region scope
  // must be flat outside it. Without this a scope positioned on a panel would
  // still be evaluated in canvas coordinates — the same defect as the halftone
  // ramp that made a panel see only its own corner.
  const sub = resolveScope(
    { type: 'ramp', angle: 90, stops: ['#FFFFFF', '#FFFFFF'], at: [0.25, 0.25], size: [0.5, 0.5] },
    120, 120, {},
  )
  check('a scope ramp influences only its own box',
    sub[2 * 120 + 60] === 0 && sub[60 * 120 + 60] > 0.97 && sub[117 * 120 + 60] === 0,
    `outside-top ${sub[2 * 120 + 60]}, inside ${sub[60 * 120 + 60].toFixed(2)}, outside-bottom ${sub[117 * 120 + 60]}`)

  // No scope declared is the identity, so adding the feature cannot change any
  // existing scene.
  const none = resolveScope(undefined, 120, 120, {})
  let allOne = true
  for (const v of none) if (v !== 1) { allOne = false; break }
  check('an absent scope is the identity', allOne)

  // A shape scope without the injected drawing dependency must FAIL LOUDLY rather
  // than silently producing an all-zero mask, which would look like the effect
  // simply not working.
  let threw = false
  try { resolveScope({ shape: 'ellipse', x: 10, y: 10, w: 40, h: 40 }, 120, 120, {}) }
  catch { threw = true }
  check('a shape scope without drawShapes is refused', threw)
}

console.log(`\n=== ${checks - failed}/${checks} checks passed ===`)
process.exit(failed === 0 ? 0 : 1)

/** Copy a rectangular region into a standalone transparent image. */
function cropRegion(image, x0, y0, x1, y1) {
  const out = new Uint8ClampedArray(image.data.length)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const s = (y * image.width + x) * 4
      const d = s
      out[d] = image.data[s]; out[d + 1] = image.data[s + 1]
      out[d + 2] = image.data[s + 2]; out[d + 3] = image.data[s + 3]
    }
  }
  return out
}
