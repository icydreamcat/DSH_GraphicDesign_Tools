/**
 * Verification: the module that decides whether a design is any good.
 *
 * WHY THIS IS THE MOST IMPORTANT FILE HERE
 * ----------------------------------------
 * The review that produced this project's brief was blunt about where the
 * previous effort actually failed:
 *
 *   > My environment explained 30% of the failures; my technique explained 30%;
 *   > and AESTHETIC AND DESIGN UNDERSTANDING explained 40%. And the environment
 *   > part only affected my ability to RESCUE a design — it never caused the
 *   > initial design errors. Even with every API returned to me, the output
 *   > would not suddenly be professional, because I did not know what it should
 *   > look like to be good enough.
 *
 * and it ended with the single most useful instruction in the document:
 *
 *   > Do not give me more drawing tools. Give me tools that can VERIFY the
 *   > output. What I failed at most was not "I could not draw it", it was
 *   > "I drew it and could not tell whether it was right".
 *
 * So this module is where the aesthetic lives. Every rule below is a
 * *relational* check, because the review's failure list was six-for-six
 * relational errors — proportion, weight, density, hierarchy, material
 * understanding, order — and not one of them was "the colour was ugly" or "the
 * shape was unattractive". Relationship is what there is to get right.
 *
 * The rules encode the reference language's actual measured signature, which
 * the review identified as the single transferable insight:
 *
 *   > The reference's complexity comes from HIGH FREQUENCY, LOW CONTRAST —
 *   > very many elements, each extremely faint. I produced LOW FREQUENCY, HIGH
 *   > CONTRAST — few elements, each heavy. That is why it looked clumsy.
 *
 * `textureStats` in tone.mjs measures exactly those two numbers, so this file
 * can check the signature instead of hoping for it.
 *
 * THREE LEVELS OF VERIFICATION
 * ----------------------------
 *   verifyScene(scene)      static — reads the scene, no rendering. Catches the
 *                           proportional and structural errors before a render
 *                           is even spent.
 *   verifyRender(a, spec)   measured — compares what was actually drawn against
 *                           what was intended. Catches overflow, silent font
 *                           fallback, misplaced geometry.
 *   selfCritique(analysis)  the four questions from the brief, answered from a
 *                           finished image: what would improve it if deleted,
 *                           is the focus unique, does hierarchy survive without
 *                           colour, does the layout carry a character.
 */

import { relativeLuminance, contrastRatio, parseColor } from './color.mjs'
import { resolveLength } from './render.mjs'

/** Collecting helper so rules read declaratively. */
class Findings {
  /**
   * @param {Record<string,string>} [allow] code -> the reason it is allowed.
   *   Some of these rules inspect the SCENE, not the picture: they can only
   *   compare a text layer's colour against the page's declared `ground`,
   *   because they never see what is actually underneath it. A knocked-out
   *   letter on a solid tile — the reference language's signature move, where
   *   paper-white type sits on an olive square — therefore measures 1:1 against
   *   the paper ground and is reported as invisible, when on the tile it is
   *   2.1:1 and plainly legible.
   *
   *   The alternative to this list is to distort the design until the rule stops
   *   complaining (adding a stroke, which turns a knockout into an outline, or
   *   darkening the letter, which makes olive-on-olive). That is the rule
   *   changing the design rather than describing it, and it makes the picture
   *   worse. So an allowance is explicit, carries a written reason, and stays in
   *   the report as a note — visible to a reviewer, impossible to apply by
   *   accident, and unable to hide an unrelated failure of the same code by
   *   wildcard.
   */
  constructor(allow = {}) {
    this.issues = []
    this.metrics = {}
    this.allow = allow
  }

  /** Record an issue at `severity`, downgraded if its code is allowed. */
  push(severity, code, message, detail) {
    const reason = Object.prototype.hasOwnProperty.call(this.allow, code) ? this.allow[code] : undefined
    if (reason !== undefined) {
      this.issues.push({
        severity: 'allowed',
        code,
        message: `${message} — ALLOWED: ${reason}`,
        detail,
        suppressedSeverity: severity,
      })
      return
    }
    this.issues.push({ severity, code, message, detail })
  }

  /** A defect that makes the design wrong. */
  error(code, message, detail) {
    this.push('error', code, message, detail)
  }

  /** A weakness that a reviewer would raise, but not a defect. */
  warn(code, message, detail) {
    this.push('warning', code, message, detail)
  }

  /** A positive confirmation worth reporting, so success is visible too. */
  note(code, message, detail) {
    this.push('note', code, message, detail)
  }
}

/**
 * Flatten a scene's layers, tracking inherited context.
 *
 * @param {object[]} layers
 * @param {object} [inherited]
 * @returns {object[]}
 */
export function flattenLayers(layers, inherited = {}) {
  const out = []
  for (const layer of Array.isArray(layers) ? layers : []) {
    if (layer === null || typeof layer !== 'object') continue
    const context = {
      depth: (inherited.depth === undefined ? 0 : inherited.depth) + 1,
      insideGroup: inherited.insideGroup === true || layer.kind === 'group' || layer.shape === 'group',
    }
    out.push({ layer, ...context })
    if (Array.isArray(layer.children)) out.push(...flattenLayers(layer.children, context))
  }
  return out
}

/**
 * Static verification of a scene, before anything is rendered.
 *
 * @param {object} scene
 * @returns {{issues: object[], metrics: object, spec: object}}
 */
export function verifyScene(scene) {
  if (scene === null || typeof scene !== 'object') {
    const f = new Findings()
    f.error('scene.invalid', 'scene must have a canvas with width and height')
    return { issues: f.issues, metrics: f.metrics, spec: {} }
  }
  // `scene.allow` maps a rule code to the written reason it is permitted here.
  // See the Findings constructor for why this exists and what it must not be
  // used for.
  const f = new Findings(scene.allow === undefined || scene.allow === null ? {} : scene.allow)
  if (scene.canvas === undefined) {
    f.error('scene.invalid', 'scene must have a canvas with width and height')
    return { issues: f.issues, metrics: f.metrics, spec: {} }
  }
  const W = scene.canvas.width
  const H = scene.canvas.height
  const flat = flattenLayers(scene.layers)

  // ── the unique-focus question ───────────────────────────────────────────
  // "Squint and look: is the focus unique? Several focuses means no focus."
  // Operationalised as: at most one element may claim the top size band.
  const textLayers = flat.filter((e) => e.layer.shape === 'text' && e.layer.text)
  const sizes = textLayers
    .map((e) => ({
      id: e.layer.id,
      text: String(e.layer.text).slice(0, 24),
      size: resolveLength(e.layer.font === undefined ? undefined : e.layer.font.size, H, e.layer.size === undefined ? 16 : e.layer.size),
    }))
    .sort((a, b) => b.size - a.size)
  f.metrics.textSizes = sizes

  if (sizes.length >= 2) {
    const biggest = sizes[0]
    const second = sizes[1]
    // A type scale is legible when adjacent steps differ by enough to read as
    // deliberate. Below ~1.25 the two sizes look like a mistake rather than a
    // hierarchy; above ~3 the step is so large it stops being a scale.
    const ratio = biggest.size / Math.max(0.001, second.size)
    f.metrics.primaryTypeRatio = round(ratio)
    if (ratio < 1.25) {
      f.error('hierarchy.typeStepTooSmall',
        `the largest text (${biggest.size}px "${biggest.text}") is only ${round(ratio)}× the next (${second.size}px "${second.text}") — too close to read as a hierarchy`,
        { biggest, second })
    } else if (ratio > 8) {
      f.warn('hierarchy.typeStepVeryLarge',
        `the gap between the largest text (${biggest.size}px) and the next (${second.size}px) is ${round(ratio)}× — check that the second level is still legible`,
        { biggest, second })
    } else {
      f.note('hierarchy.typeStep', `primary type is ${round(ratio)}× the secondary — a readable step`, { biggest, second })
    }

    // Only one primary. Two headlines at nearly the same size is two focuses.
    const nearPrimary = sizes.filter((s) => s.size > biggest.size / 1.15)
    if (nearPrimary.length > 1) {
      f.error('hierarchy.multipleFocus',
        `${nearPrimary.length} text elements sit within 15% of the largest size (${nearPrimary.map((s) => `${s.size}px "${s.text}"`).join(', ')}) — the focus is not unique`,
        { nearPrimary })
    }
  }

  // ── the proportion question ─────────────────────────────────────────────
  // "Subject at 90% of canvas height" was a listed error; the correct band is
  // 50-65% with room to breathe.
  //
  // WHAT THIS RULE IS ABOUT, AND WHAT IT IS NOT
  // -------------------------------------------
  // It is about SUBJECT PLATES — a placed figure — because a figure at 90% of
  // the canvas has nowhere to breathe. It is not about background bands, ground
  // washes and full-bleed atmosphere, which are legitimate and common (the
  // reference itself bleeds its ghost figure past the frame). The first version
  // of this check tested `hFraction > 0.75 || wFraction > 0.75` and therefore
  // flagged any wide image at all: a 2560 x 195 canopy strip and a full-width
  // 74%-high ground band both came back as "subject too large", which is not
  // what either of them is.
  //
  // The discriminator is that a subject plate is large in BOTH axes while a
  // band is large in one. Requiring both keeps the original rule intact for the
  // case it was written for and stops it firing on composition.
  const imageLayers = flat.filter((e) => e.layer.shape === 'image')
  for (const e of imageLayers) {
    const hFraction = resolveLength(e.layer.h, H, H) / H
    const wFraction = resolveLength(e.layer.w, W, W) / W
    const isBand = wFraction > 0.75 && hFraction <= 0.75
    if (hFraction > 0.75 && wFraction > 0.75) {
      f.error('proportion.subjectTooLarge',
        `image "${e.layer.id}" occupies ${round(wFraction * 100)}% × ${round(hFraction * 100)}% of the canvas — over 75% on both axes leaves no breathing space (target 50-65%)`,
        { id: e.layer.id, wFraction: round(wFraction), hFraction: round(hFraction) })
    } else if (isBand) {
      f.note('proportion.band',
        `image "${e.layer.id}" spans ${round(wFraction * 100)}% of the width at ${round(hFraction * 100)}% height — a background band, not a subject plate, so the 50-65% subject band does not apply`,
        { id: e.layer.id, wFraction: round(wFraction), hFraction: round(hFraction) })
    } else if (hFraction >= 0.45 && hFraction <= 0.72) {
      f.note('proportion.subject', `image "${e.layer.id}" at ${round(hFraction * 100)}% height sits in the intended band`, { id: e.layer.id })
    }
  }

  // ── the high-frequency / low-contrast question ──────────────────────────
  // The core insight. Many elements, each faint — not few and heavy.
  const visible = flat.filter((e) => e.layer.hidden !== true && e.layer.kind !== 'adjustment')
  const opacities = visible.map((e) => (e.layer.opacity === undefined ? 1 : e.layer.opacity))
  const meanOpacity = opacities.length === 0 ? 1 : opacities.reduce((a, b) => a + b, 0) / opacities.length
  const heavyShare = opacities.filter((o) => o >= 0.85).length / Math.max(1, opacities.length)
  f.metrics.elementCount = visible.length
  f.metrics.meanOpacity = round(meanOpacity)
  f.metrics.heavyShare = round(heavyShare)

  if (visible.length < 8) {
    f.warn('density.tooFewElements',
      `only ${visible.length} visible elements — the reference language gets its richness from many marks, not from a few large ones`,
      { count: visible.length })
  }

  /**
   * HOMOGENEITY — how much of this scene is the same element repeated.
   *
   * The paired failure to "not enough detail" is "the same detail N times", and it is the one that
   * looks like success on every count this file already took: the element count is high, the
   * opacity is low, the detail is local. Thirteen copies of one card pass all of them.
   *
   * Measured from the SCENE rather than the pixels, because it is a claim about repetition and the
   * scene knows exactly what repeated. A pixel measure cannot tell "twenty marks that differ" from
   * "twenty marks that do not" at small sizes — which is the same resolution limit that made the
   * ratio-based detail criterion useless, so this does not repeat that mistake.
   *
   * The signature is shape + quantised size, not id: ids are unique by construction and would
   * always report a maximum-entropy scene.
   */
  const sig = (l) => {
    const q = (v) => (v === undefined ? '·' : String(Math.round(Number(v) * 4) / 4))
    return [l.shape ?? 'rect', q(l.w), q(l.h), q(l.r ?? l.radius)].join('|')
  }
  const groups = new Map()
  for (const e of visible) {
    const k = sig(e.layer)
    const g = groups.get(k) ?? { n: 0, sample: String(e.layer.id ?? ''), shape: e.layer.shape ?? 'rect' }
    g.n++
    groups.set(k, g)
  }
  const ranked = [...groups.values()].sort((a, b) => b.n - a.n)
  const biggest = ranked[0] ?? { n: 0, sample: '', shape: '' }
  const distinctSignatures = groups.size
  const largestShare = visible.length === 0 ? 0 : biggest.n / visible.length
  f.metrics.distinctElementSignatures = distinctSignatures
  f.metrics.largestRepeatedGroup = biggest.n
  f.metrics.largestRepeatedShare = round(largestShare)

  if (visible.length >= 12 && largestShare > 0.5 && distinctSignatures <= 4) {
    f.error('density.homogeneous',
      `${biggest.n} of ${visible.length} elements are the same signature (${biggest.shape}, "${biggest.sample}") and the whole scene has only ${distinctSignatures} distinct signatures. That is one element repeated, not a system: its information content is one element's. Vary the group along the axes a reader actually reads — which form, how many, how heavy.`,
      { repeated: biggest.n, of: visible.length, signatures: distinctSignatures })
  } else if (visible.length >= 12 && largestShare > 0.35) {
    f.warn('density.repetitive',
      `${biggest.n} of ${visible.length} elements (${round(largestShare * 100)}%) share one signature, across ${distinctSignatures} signatures — much of the surface is repetition. Check whether each copy carries its own information.`,
      { repeated: biggest.n, of: visible.length, signatures: distinctSignatures })
  } else if (visible.length >= 12) {
    f.note('density.varied',
      `${distinctSignatures} distinct signatures across ${visible.length} elements; the largest group is ${biggest.n} (${round(largestShare * 100)}%)`,
      { signatures: distinctSignatures, largest: biggest.n })
  }

  if (heavyShare > 0.6 && visible.length < 25) {
    f.warn('density.everythingHeavy',
      `${round(heavyShare * 100)}% of elements are at 85%+ opacity with only ${visible.length} elements total — this is the "few elements, each heavy" signature that reads as clumsy. Raise the count and lower the weight.`,
      { heavyShare: round(heavyShare), count: visible.length })
  }
  if (visible.length >= 15 && meanOpacity <= 0.6) {
    f.note('density.frequency', `${visible.length} elements at mean opacity ${round(meanOpacity)} — the high-frequency low-contrast signature`, { count: visible.length, meanOpacity: round(meanOpacity) })
  }

  // ── the accent question ─────────────────────────────────────────────────
  // "Accent colour share ≤5%" is a hard constraint, and it is about the
  // *rendered* share, so this only checks the flat-colour approximation. The
  // measured check happens in verifyRender.
  const accentCount = visible.filter((e) => {
    const paint = e.layer.paint
    if (typeof paint !== 'string') return false
    try {
      const c = parseColor(paint)
      const mx = Math.max(c.r, c.g, c.b)
      const mn = Math.min(c.r, c.g, c.b)
      return mx > 0 && (mx - mn) / mx > 0.35
    } catch { return false }
  }).length
  f.metrics.chromaticElementCount = accentCount

  // ── the grid / texture question ─────────────────────────────────────────
  // "A grid spread evenly across the whole canvas" was a listed error. The
  // correct treatment is local, chosen, and fading.
  const grids = flat.filter((e) => {
    const id = String(e.layer.id === undefined ? '' : e.layer.id)
    return e.layer.shape === 'group' && Array.isArray(e.layer.children) &&
      e.layer.children.length >= 8 && /grid|rule|tick|hatch/i.test(id)
  })
  for (const g of grids) {
    if (g.layer.mask === undefined && (g.layer.opacity === undefined || g.layer.opacity > 0.5)) {
      f.warn('texture.gridUniform',
        `grid group "${g.layer.id}" has ${g.layer.children.length} rules and no mask, at opacity ${g.layer.opacity === undefined ? 1 : g.layer.opacity} — an unmasked, unmuted grid covers the canvas uniformly. Give it a fade mask or drop the opacity.`,
        { id: g.layer.id, children: g.layer.children.length })
    } else {
      f.note('texture.gridLocal', `grid group "${g.layer.id}" is faded or muted, so it appears locally rather than as a full coverage`, { id: g.layer.id })
    }
  }

  // ── the knock-out question ──────────────────────────────────────────────
  // "Text degenerating into the same colour as the background" was listed.
  // Light text on a light ground with no outline is invisible.
  for (const e of textLayers) {
    const paint = e.layer.paint === undefined ? e.layer.color : e.layer.paint
    const ground = typeof scene.ground === 'string' ? scene.ground : '#FFFFFF'
    if (typeof paint !== 'string' || paint === undefined) continue
    try {
      const ratio = contrastRatio(paint, ground)
      const stroke = e.layer.stroke
      const hasStroke = stroke !== undefined && stroke !== null && stroke !== false
      if (ratio < 1.6 && !hasStroke) {
        f.error('contrast.invisibleText',
          `text "${e.layer.id}" has only ${round(ratio)}:1 contrast against the ground and no outline — it will not read`,
          { id: e.layer.id, color: paint, ground, ratio: round(ratio) })
      } else if (ratio < 2.5 && hasStroke) {
        f.note('contrast.outlinedText',
          `text "${e.layer.id}" is low-contrast against the ground but carries an outline, which is the intended treatment`,
          { id: e.layer.id, ratio: round(ratio) })
      }
    } catch { /* an unparseable paint is reported by the renderer */ }
  }

  return {
    issues: f.issues,
    metrics: f.metrics,
    spec: {
      canvas: { width: W, height: H },
      ground: scene.ground,
      elementCount: visible.length,
      meanOpacity: round(meanOpacity),
    },
  }
}

/**
 * Measured verification: compare a finished render against the intent.
 *
 * @param {object} analysis output of analyseReference on the rendered PNG
 * @param {object} spec the `spec` returned by verifyScene
 * @returns {{issues: object[], metrics: object}}
 */
export function verifyRender(analysis, spec) {
  const f = new Findings()

  // Accent share is a rendered property: the review's constraint is ≤5% of
  // pixels. Read it against `flatShare` — the share held by large flat fills —
  // rather than the raw chromatic share, because a reference that contains an
  // illustration is legitimately ~20% chromatic in its watercolour while its
  // DESIGNED accent is still a few percent. Judging the raw figure would flag
  // every illustrated reference as a violation.
  const accentShare = analysis.accent.share
  const flatShare = analysis.accent.flatShare === undefined ? accentShare : analysis.accent.flatShare
  f.metrics.accentShare = accentShare
  f.metrics.accentFlatShare = flatShare
  if (flatShare > 0.08) {
    f.warn('accent.tooMuch',
      `flat chromatic fills are ${round(flatShare * 100)}% of the frame — the reference sits at 1-5%. An accent stops being an accent at this size.`,
      { flatShare, rawChromaticShare: accentShare, flatColors: analysis.accent.flatColors })
  } else if (flatShare >= 0.004 && flatShare <= 0.05) {
    f.note('accent.correct', `flat chromatic fills are ${round(flatShare * 100)}% of the frame — an accent, not a field`, { flatShare })
  } else if (flatShare < 0.004) {
    // Not necessarily wrong: a design can be entirely monochrome by intent. It
    // is reported so the choice is visible rather than accidental.
    f.warn('accent.almostNone', `only ${round(flatShare * 100)}% of the frame is flat chromatic fill — the design may read as uncoloured rather than restrained (${round(accentShare * 100)}% is chromatic overall, mostly illustration)`, { flatShare, rawChromaticShare: accentShare })
  }

  // Tone band. A designed surface usually holds its tonality in a narrower band
  // than a photograph; a very wide band usually means uncontrolled contrast.
  const dr = analysis.tone.dynamicRange
  f.metrics.dynamicRange = dr
  f.metrics.meanLuma = analysis.tone.groundLuminance
  if (dr > 0.85) {
    f.warn('tone.rangeTooWide', `the tone band spans ${round(dr)} of luminance — near full black-to-white, which loses the low-contrast character of the reference`, { dynamicRange: dr })
  } else if (dr >= 0.2 && dr <= 0.75) {
    f.note('tone.band', `the tone band spans ${round(dr)} — a controlled range`, { dynamicRange: dr })
  }
  if (analysis.tone.groundLuminance < 0.25) {
    f.warn('tone.veryDark', `mean luminance is ${round(analysis.tone.groundLuminance)} — the design is very dark overall; confirm that was intended`, { meanLuma: analysis.tone.groundLuminance })
  }

  // The high-frequency signature, measured on the finished pixels. This is the
  // check the review asked for and could not perform.
  //
  // Calibrated against the actual reference: its cell detail runs 0.001..0.056
  // with a mean near 0.02, and it contains both empty regions (the flat ground
  // corners) and dense ones. So the useful question is not "is the mean high" —
  // a design that is mostly empty ground legitimately has a low mean — but
  // "does any part of the canvas carry real detail, and is the detail localised
  // rather than uniform". Those two are what the reference's character actually
  // consists of.
  const detailValues = analysis.spatial.cells.map((c) => c.detail)
  const meanDetail = detailValues.reduce((a, b) => a + b, 0) / Math.max(1, detailValues.length)
  const maxDetail = Math.max(...detailValues)
  const cellsWithDetail = detailValues.filter((d) => d > 0.012).length
  f.metrics.meanCellDetail = round(meanDetail)
  f.metrics.maxCellDetail = round(maxDetail)
  f.metrics.cellsWithDetail = cellsWithDetail
  if (maxDetail < 0.008) {
    f.error('texture.flat',
      `peak local detail is only ${round(maxDetail)} — the whole surface is flat. Nothing carries the high-frequency detail the reference language is built from.`,
      { maxDetail, meanDetail: round(meanDetail) })
  } else if (cellsWithDetail === 0) {
    f.warn('texture.noDetailedRegion',
      `no cell reaches meaningful detail (peak ${round(maxDetail)}) — detail is present but too evenly spread and too faint to register as a local event`,
      { maxDetail, meanDetail: round(meanDetail) })
  } else {
    f.note('texture.detail',
      `peak local detail ${round(maxDetail)}, mean ${round(meanDetail)}, ${cellsWithDetail} of ${detailValues.length} cells carry real detail`,
      { maxDetail, meanDetail: round(meanDetail), cellsWithDetail })
  }

  // Is the detail localised rather than uniform? "Grid spread evenly over the
  // whole canvas" was a listed error, and its signature is detail present in
  // essentially every cell at a similar level.
  const maxForCoverage = Math.max(1e-6, maxDetail)
  const cellsAboveFloor = detailValues.filter((d) => d > maxForCoverage * 0.18).length
  const coverage = cellsAboveFloor / detailValues.length
  f.metrics.detailCoverage = round(coverage)
  if (coverage > 0.97 && meanDetail > 0.02) {
    f.warn('texture.everywhere',
      `detail at a comparable level reaches ${round(coverage * 100)}% of cells — texture that covers everything evenly stops being a local event. Let it fade out over part of the canvas.`,
      { coverage, meanDetail: round(meanDetail) })
  } else {
    f.note('texture.local',
      `detail concentrates in ${round(coverage * 100)}% of cells — local rather than universal`,
      { coverage })
  }

  // Element count, measured rather than declared.
  f.metrics.measuredElements = analysis.structure.elementCount
  if (analysis.structure.elementCount < 6) {
    f.warn('composition.sparse', `only ${analysis.structure.elementCount} distinct regions were resolved — the layout may be too sparse for this language`, { count: analysis.structure.elementCount })
  }

  /**
   * THE ACCENT BUDGET, SURFACED HERE BECAUSE THIS IS WHERE THE PIXELS ARE ALREADY BEING READ.
   *
   * `H7` in the delivery gate compares the accent's flat share against the band the scene declared.
   * It read `report.verification.metrics.accentFlatShare`, and **that key was never written by
   * anything** — so the check skipped on every delivery while printing a reason that read like a
   * judgement about the scene ("report carries no accentFlatShare") rather than a hole in the
   * toolchain. A gate that skips for a reason it invented is the silent pass this whole system
   * exists to remove; it was the one remaining instance of it.
   *
   * The analysis is already running two hundred lines above, so the fix is to publish what it
   * already knows rather than to measure twice.
   */
  if (analysis.accent !== undefined) {
    if (typeof analysis.accent.flatShare === 'number') f.metrics.accentFlatShare = analysis.accent.flatShare
    if (typeof analysis.accent.share === 'number') f.metrics.accentHueShare = analysis.accent.share
  }

  return { issues: f.issues, metrics: f.metrics }
}

/**
 * The four questions from the brief, answered from a finished image.
 *
 * The brief states them as the operational test of whether a design holds up:
 *   1. Delete half the elements — is the information still complete?
 *   2. Squint — is the focus unique?
 *   3. Remove colour — does the hierarchy still hold?
 *   4. Ignore the content — does the layout alone convey a character?
 *
 * Questions 2 and 4 are answerable from measurements; 1 and 3 are judgements
 * the agent has to make, so this returns them as explicit prompts rather than
 * inventing an answer. Reporting a question as *asked* is more honest than
 * fabricating a verdict for it.
 *
 * @param {object} analysis
 * @returns {{summary:string, answers:object[], focus:object, character:object}}
 */
export function selfCritique(analysis) {
  const cells = analysis.spatial.cells
  const byDetail = [...cells].sort((a, b) => b.detail - a.detail)
  const byLuma = [...cells].sort((a, b) => a.meanLuma - b.meanLuma)

  // Question 2: focus. The focus is the region that differs most from the mean
  // tone. A unique focus means one region clearly leads; several near-equal
  // leaders means none does.
  const meanLuma = analysis.tone.groundLuminance
  const salience = cells.map((c) => ({
    col: c.col, row: c.row,
    score: Math.abs(c.meanLuma - meanLuma) + c.detail * 2,
  })).sort((a, b) => b.score - a.score)
  const top = salience[0]
  const runnersUp = salience.filter((s) => s.score > top.score * 0.8).length
  const focus = {
    region: { col: top.col, row: top.row, x: top.col / analysis.spatial.cols, y: top.row / analysis.spatial.rows },
    score: round(top.score),
    competingRegions: runnersUp - 1,
    unique: runnersUp <= 2,
  }

  // Question 4: character. A layout carries a character independent of its
  // content when it has a clear tone structure, a measurable grid, and a
  // consistent stroke vocabulary.
  const gridPresent = analysis.grid.columnPitch !== null || analysis.grid.rowPitch !== null
  const strokeConsistent = analysis.structure.strokeWeights.length > 0 &&
    analysis.structure.strokeWeights[0].share > 0.3
  const toneStructured = analysis.tone.dynamicRange > 0.1 && analysis.tone.dynamicRange < 0.9
  const character = {
    gridPresent,
    strokeConsistent,
    toneStructured,
    holdsWithoutContent: gridPresent && strokeConsistent && toneStructured,
  }

  const answers = [
    {
      question: 'Delete half the elements — is the information still complete?',
      answerable: false,
      prompt: 'If removing half the elements loses no information, that half was decoration. Count the elements that carry information and compare with the total.',
      measured: { elementCount: analysis.structure.elementCount },
    },
    {
      question: 'Squint — is the focus unique?',
      answerable: true,
      answer: focus.unique
        ? `yes — one region leads at (${focus.region.col}, ${focus.region.row}) with ${focus.competingRegions} competing`
        : `no — ${focus.competingRegions} regions are within 20% of the leader, so there is no single focus`,
      measured: focus,
    },
    {
      question: 'Remove colour — does the hierarchy still hold?',
      answerable: false,
      prompt: 'Hierarchy carried by colour alone is the most fragile kind. Check that size, weight and position alone still order the information.',
      measured: { accentShare: analysis.accent.share },
    },
    {
      question: 'Ignore the content — does the layout convey a character?',
      answerable: true,
      answer: character.holdsWithoutContent
        ? `yes — a measurable grid (pitch ${analysis.grid.columnPitch === null ? '—' : analysis.grid.columnPitch}px), a consistent stroke vocabulary (${analysis.structure.strokeWeights[0] === undefined ? '—' : analysis.structure.strokeWeights[0].weight + 'px dominant'}), and a controlled tone band`
        : `not yet — ${[!gridPresent ? 'no measurable grid' : null, !strokeConsistent ? 'no dominant stroke weight' : null, !toneStructured ? 'tone range is not controlled' : null].filter(Boolean).join('; ')}`,
      measured: { ...character, grid: analysis.grid },
    },
  ]

  const summary = [
    `tone: mean ${round(analysis.tone.groundLuminance)}, band ${round(analysis.tone.dynamicRange)}`,
    `accent: ${round(analysis.accent.share * 100)}% of frame`,
    `structure: ${analysis.structure.elementCount} regions, dominant stroke ${analysis.structure.strokeWeights[0] === undefined ? '—' : analysis.structure.strokeWeights[0].weight + 'px'}`,
    `grid: ${analysis.grid.columnPitch === null ? 'none detected' : analysis.grid.columnPitch + 'px columns'}`,
    `focus: ${focus.unique ? 'unique' : 'competing'} at cell (${focus.region.col}, ${focus.region.row})`,
    `detail: mean ${round(analysis.spatial.cells.reduce((a, c) => a + c.detail, 0) / cells.length)}`,
  ].join('\n')

  return { summary, answers, focus, character, darkestCell: byLuma[0], busiestCell: byDetail[0] }
}

function round(v) {
  return Math.round(v * 1000) / 1000
}
