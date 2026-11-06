/**
 * Measurement: the ground truth that makes "accurate" checkable.
 *
 * WHY THIS EXISTS BEFORE ANY OPERATOR
 * -----------------------------------
 * The whole palette rests on one claim: a filter can be described precisely enough
 * that two people building it produce the same picture. That claim is only worth
 * anything if the result can be MEASURED — otherwise "accurate" is an adjective, and
 * every disagreement becomes a matter of opinion.
 *
 * So this module is written first. Every palette operator reports these figures, and
 * a captured preset is a set of operators plus the measurements they produced. A
 * preset therefore carries its own evidence: re-running it and comparing the numbers
 * is a check, not a guess.
 *
 * WHAT IS MEASURED, AND WHY EACH ONE
 * ----------------------------------
 *   solidity        share of opaque pixels. Zero means nothing was drawn; that is
 *                   the failure this project has hit most often and reported least.
 *   coverage        mean alpha. Distinguishes "drew a solid shape" from "drew a
 *                   faint one", which solidity alone cannot.
 *   lumaMean/Sd     mean and spread of luminance. This is where tonal operators show
 *                   up, and where a "contrast" that did nothing becomes visible.
 *   channelMean     per-channel means. A colour shift is a vector, and reporting one
 *                   number for it loses the direction — the thing a designer
 *                   actually cares about.
 *   changedFraction share of pixels that differ from the input at all. The single
 *                   most useful figure here: it says WHERE and HOW MUCH an operator
 *                   acted, and 0 is an unambiguous failure.
 *   edgeEnergy      mean gradient magnitude. Blur lowers it, sharpening raises it, and
 *                   neither is visible in the means.
 *   opaqueFraction  share of pixels with any alpha, before and after, so a knockout
 *                   is distinguishable from a repaint.
 *
 * All figures are computed from the rendered result, never from the intention — which
 * is the rule the repair notes state for audits and which this module exists to obey.
 */

/** Luminance of one RGBA pixel, Rec.709 weights, 0..255. */
function luma(d, i) {
  return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
}

/**
 * Mean gradient magnitude over the alpha and luminance channels.
 *
 * A forward difference rather than a second derivative: it is cheap, and its only job
 * is to move in the right direction when something is blurred or sharpened. The value
 * is meaningless in absolute terms and meaningful in comparison, which is how it is
 * reported and how it is used.
 */
function edgeEnergy(d, w, h) {
  let sum = 0
  let n = 0
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = (y * w + x) * 4
      const r = (y * w + x + 1) * 4
      const b = ((y + 1) * w + x) * 4
      const al = Math.abs(d[r + 3] - d[i + 3]) + Math.abs(d[b + 3] - d[i + 3])
      const ll = Math.abs(luma(d, r) - luma(d, i)) + Math.abs(luma(d, b) - luma(d, i))
      sum += al + ll
      n += 2
    }
  }
  return n === 0 ? 0 : sum / n
}

/**
 * Describe one image on its own.
 *
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img
 * @returns {object} measurements
 */
export function measure(img) {
  const { width: w, height: h, data } = img
  const n = w * h
  let opaque = 0
  let alphaSum = 0
  let lumaSum = 0
  let lumaSq = 0
  let lumaCount = 0
  const chan = [0, 0, 0]
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    alphaSum += a
    if (a > 8) opaque++
    // Luminance statistics cover INKED pixels only. Including transparent black
    // would make an image's mean luminance depend mostly on how much empty canvas it
    // happens to sit on, which is not a property of the artwork.
    if (a > 200) {
      const l = luma(data, i)
      lumaSum += l
      lumaSq += l * l
      lumaCount++
    }
    chan[0] += data[i]
    chan[1] += data[i + 1]
    chan[2] += data[i + 2]
  }
  const lumaMean = lumaCount === 0 ? 0 : lumaSum / lumaCount
  const variance = lumaCount === 0 ? 0 : Math.max(0, lumaSq / lumaCount - lumaMean * lumaMean)
  return {
    solidity: Number((opaque / n).toFixed(5)),
    coverage: Number((alphaSum / n / 255).toFixed(5)),
    lumaMean: Number(lumaMean.toFixed(2)),
    lumaSd: Number(Math.sqrt(variance).toFixed(2)),
    channelMean: chan.map((c) => Number((c / n).toFixed(2))),
    edgeEnergy: Number(edgeEnergy(data, w, h).toFixed(3)),
  }
}

/**
 * Describe what changed between two images.
 *
 * The `changedFraction` is the figure that has caught the most real defects in this
 * project: an operator that reports success while changing nothing shows up here as
 * exactly zero, which is impossible to argue with.
 *
 * @param {object} before
 * @param {object} after
 * @param {{tolerance?:number}} options per-channel difference counted as a change
 */
export function delta(before, after, options = {}) {
  const tol = options.tolerance === undefined ? 1 : options.tolerance
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error(
      `delta needs two images of the same size, got ${before.width}x${before.height} and ${after.width}x${after.height}`,
    )
  }
  const a = before.data
  const b = after.data
  const n = before.width * before.height
  let changed = 0
  let alphaDown = 0
  let alphaUp = 0
  let maxChannel = 0
  let sumAbs = 0
  for (let i = 0; i < a.length; i += 4) {
    let differs = false
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(a[i + c] - b[i + c])
      sumAbs += d
      if (d > maxChannel) maxChannel = d
      if (d > tol) differs = true
    }
    if (differs) changed++
    if (b[i + 3] < a[i + 3] - tol) alphaDown++
    else if (b[i + 3] > a[i + 3] + tol) alphaUp++
  }
  const mb = measure(before)
  const ma = measure(after)
  return {
    changedFraction: Number((changed / n).toFixed(5)),
    meanAbsChannelDelta: Number((sumAbs / (n * 4)).toFixed(3)),
    maxChannelDelta: maxChannel,
    alphaRemoved: Number((alphaDown / n).toFixed(5)),
    alphaAdded: Number((alphaUp / n).toFixed(5)),
    lumaMeanShift: Number((ma.lumaMean - mb.lumaMean).toFixed(2)),
    lumaSdShift: Number((ma.lumaSd - mb.lumaSd).toFixed(2)),
    channelMeanShift: ma.channelMean.map((c, i) => Number((c - mb.channelMean[i]).toFixed(2))),
    edgeEnergyShift: Number((ma.edgeEnergy - mb.edgeEnergy).toFixed(3)),
  }
}

/**
 * Assert that an operator actually did something, and optionally that it did what was
 * asked.
 *
 * Every operator in the palette runs through this, so "the operator silently did
 * nothing" becomes a reported failure at the point it happens rather than a discovery
 * several steps later. That is the automation of a defect class this project hit
 * repeatedly: a halftone that reported 7007 dots while drawing none, a duotone scoped
 * into a corner, a screen that erased what the previous effect protected.
 *
 * A single check cannot cover every way an operator can be wrong. It can cover the
 * one way that is otherwise invisible: doing nothing at all.
 *
 * @param {string} label
 * @param {object} d result of `delta`
 * @param {{atLeast?:number, atMost?:number, minLumaShift?:number}} expect
 */
export function assertDid(d, expect = {}) {
  const problems = []
  const atLeast = expect.atLeast === undefined ? 0 : expect.atLeast
  if (d.changedFraction <= atLeast) {
    problems.push(
      `changed ${(d.changedFraction * 100).toFixed(3)}% of pixels, expected more than ${(atLeast * 100).toFixed(3)}%`,
    )
  }
  if (expect.atMost !== undefined && d.changedFraction > expect.atMost) {
    problems.push(
      `changed ${(d.changedFraction * 100).toFixed(3)}% of pixels, expected at most ${(expect.atMost * 100).toFixed(3)}%`,
    )
  }
  if (expect.minLumaShift !== undefined && Math.abs(d.lumaMeanShift) < expect.minLumaShift) {
    problems.push(
      `mean luminance moved ${d.lumaMeanShift}, expected at least ${expect.minLumaShift}`,
    )
  }
  return { ok: problems.length === 0, problems }
}

/**
 * Compare two sets of measurements for equivalence within a tolerance.
 *
 * This is how a preset proves it still does what it did. A preset carries the
 * measurements taken when it was captured; re-running it and calling this reports
 * whether the result is the same picture, and by how much it is not. Without it, a
 * stored preset is a claim with no evidence behind it.
 */
export function sameWithin(a, b, tolerance = {}) {
  const t = {
    lumaMean: tolerance.lumaMean === undefined ? 0.5 : tolerance.lumaMean,
    lumaSd: tolerance.lumaSd === undefined ? 0.5 : tolerance.lumaSd,
    coverage: tolerance.coverage === undefined ? 0.002 : tolerance.coverage,
    solidity: tolerance.solidity === undefined ? 0.002 : tolerance.solidity,
    channelMean: tolerance.channelMean === undefined ? 0.5 : tolerance.channelMean,
    edgeEnergy: tolerance.edgeEnergy === undefined ? 0.5 : tolerance.edgeEnergy,
  }
  const diffs = {}
  let worst = 0
  for (const [key, limit] of Object.entries(t)) {
    const av = a[key]
    const bv = b[key]
    if (av === undefined || bv === undefined) continue
    const d = Array.isArray(av)
      ? Math.max(...av.map((v, i) => Math.abs(v - bv[i])))
      : Math.abs(av - bv)
    diffs[key] = Number(d.toFixed(4))
    if (d > limit) worst = Math.max(worst, d / limit)
  }
  return { same: worst <= 1, worstRatio: Number(worst.toFixed(3)), diffs, tolerances: t }
}
