/**
 * Scene scaling — the implementation behind `design render --scale`, and the
 * `scale` argument of the `design_render` tool.
 *
 * WHY THIS IS A MODULE
 * --------------------
 * It used to live inline in `bin/design.mjs`, where only a subprocess could reach
 * it. That is exactly how this function shipped broken: the scale path had no test,
 * and `design_render` was never called with a scale in any recorded session, so
 * nothing ever exercised it.
 *
 * THE TWO DEFECTS IT ENCODES
 * --------------------------
 * Both are the same mistake in two places: a value reached by two code paths and
 * scaled by both.
 *
 * 1. THE CANVAS was rewritten and then reached again by `Object.values(scene)`,
 *    because `width`/`height` are absolute keys. The two axes did not even fail
 *    symmetrically — the width was still large enough after the first multiply to be
 *    caught again, while the rounded height had already fallen to 338 and failed the
 *    `> 1` test, so it was left alone.
 *
 *      2400x1350 @ --scale 0.5   ->  600x675   (intended 1200x675)
 *      2400x1350 @ --scale 0.25  ->  150x338   (intended  600x338)
 *
 * 2. `font.size` was multiplied by the explicit `if (o.font.size …)` branch and then
 *    AGAIN by the walk, because `font` is one of the layer's own values. A headline
 *    at 218px came out at 54px on a 0.5 draft. This is not a corner case: half the
 *    real scenes carry their size this way (`muelsyse-ginkgo.json` uses
 *    `font: { size: 218 }`, `poster-a-flat.json` uses `size: 214`).
 *
 * Both went out with an EMPTY error list and an empty warning list, so a draft could
 * be reviewed at a wrong aspect ratio and a wrong type scale, reported as clean.
 *
 * THE RULE THAT PREVENTS BOTH
 * ---------------------------
 * Every numeric leaf is scaled AT MOST ONCE, enforced by visiting every object once
 * and by not reaching into an object's values from the outside. The walk is the only
 * thing that multiplies anything: there is no separate `font.size` branch, because
 * `font` is visited like any other value.
 *
 * WHAT IS SCALED, AND WHY THAT RULE
 * ---------------------------------
 * Only absolute lengths are multiplied. A length `> 1` is read as pixels; a value in
 * `0..1` is read as a fraction of the canvas and is scale-invariant, so scaling it
 * would be wrong. `> 1` (rather than `>= 1`) is kept from the original so that a
 * literal 1-pixel hairline stays 1px instead of collapsing to 0.
 */

/** Keys whose numeric value is an absolute length in pixels. */
const ABSOLUTE_KEYS = ['x', 'y', 'w', 'h', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'radius', 'blur', 'dx', 'dy', 'lineHeight', 'size']

/**
 * Rewrite `scene` in place: multiply the canvas and every absolute length by `s`.
 *
 * Note that `d`/`o` are not in the key list — they belong to colour channels and
 * effect descriptors, not to geometry, and scaling them would corrupt colours.
 *
 * @param {object} scene - a parsed scene object; mutated in place
 * @param {number} s - positive scale factor
 * @returns {object} the same scene, for chaining
 */
export function scaleScene(scene, s) {
  if (!(s > 0)) throw new Error(`scale must be positive, got ${s}`)
  if (s === 1) return scene

  scene.canvas = {
    width: Math.round(scene.canvas.width * s),
    height: Math.round(scene.canvas.height * s),
  }

  // Objects already visited, so a value reachable by two paths is still scaled once.
  // The rewritten canvas is marked up front: it is the object this walk is standing
  // on, and re-entering it is defect 1.
  const visited = new WeakSet([scene.canvas])

  const scaleAbs = (o) => {
    if (o === null || typeof o !== 'object') return
    if (visited.has(o)) return
    visited.add(o)

    for (const k of ABSOLUTE_KEYS) {
      if (typeof o[k] === 'number' && o[k] > 1) o[k] = o[k] * s
    }
    if (Array.isArray(o.points)) o.points = o.points.map(([a, b]) => [a > 1 ? a * s : a, b > 1 ? b * s : b])

    for (const v of Object.values(o)) {
      if (Array.isArray(v)) v.forEach(scaleAbs)
      else if (v !== null && typeof v === 'object') scaleAbs(v)
    }
  }

  scaleAbs(scene)
  return scene
}
