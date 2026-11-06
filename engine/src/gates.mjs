/**
 * The `gates` block: one definition, read by both the renderer and the delivery gate.
 *
 * WHY THIS IS A SHARED MODULE AND NOT TWO CHECKS
 * ----------------------------------------------
 * The renderer refuses a scene that declares no gates; the delivery gate measures the
 * gates a scene did declare. If those two disagreed about what a valid declaration IS,
 * a scene could pass the render and be unmeasurable at delivery — which is precisely the
 * state the whole mechanism exists to prevent. One module, one list of keys, one message.
 *
 * WHY THE RENDERER REFUSES RATHER THAN WARNS
 * ------------------------------------------
 * Measured history, and the reason this file exists at all: a preset carried a long
 * always-on policy telling the agent to answer four questions before placing anything.
 * The policy was genuinely resident in every request — verified in the session record's
 * `system` field — and the session that followed violated at least nine of its own
 * principles. A requirement expressed as prose is skippable; the cost of skipping is
 * zero, so it gets skipped. The only form that survives is one where skipping costs an
 * image. Hence: no gates, no render.
 *
 * A gate that cannot fail is not a gate. Every key below is a fact about the file, and
 * every check that reads one is decidable without taste — which is the line this whole
 * mechanism has to respect, because a gate that guessed at craft would launder a taste
 * decision as a measurement.
 */

/** Keys a scene must declare before it may be rendered. */
export const REQUIRED_GATE_KEYS = ['focus', 'lightAxis', 'layers', 'drawingRule', 'accentBand', 'sequence']

/**
 * The decision order, as a rule rather than as advice.
 *
 * This comes from four synthesis courses (see `knowledge/reference/合成设计方法总纲-四门课合并.md`)
 * and it is the one thing in them that is unambiguously a RULE: the light axis has to be settled
 * before anything is placed, because "if you get the shadow direction wrong at the start, everything
 * after it is wrong" — and by the time anyone notices, every element already has a size and a
 * position. The same holds for the reading path: it decides the composition, so deciding it late
 * means re-deciding the composition.
 *
 * WHY IT LIVES IN CODE
 * --------------------
 * Written as prose it is a paragraph that gets skimmed. Written here, a declaration that skips a
 * step, or states them out of order, is refused by the renderer — which is the only form of
 * instruction this project has found to actually hold. The order is DATA so the refusal message can
 * print it and the caller can copy it.
 *
 * A STEP MAY BE MARKED INAPPLICABLE, BUT ONLY WITH A REASON. That is what keeps this from becoming
 * a quota: a flat-lay of paper objects genuinely has a light axis and no reading path, and a
 * monochrome diagram genuinely has no saturation decision. Saying so is fine. Saying nothing is not
 * — because "not applicable" and "not thought about" look identical from the outside, and only one
 * of them is acceptable.
 */
export const DECISION_SEQUENCE = [
  { key: 'inventory', label: '清点', states: 'what objects are actually on this page, their kind and where they sit' },
  { key: 'language', label: '判语言', states: 'whether the reference is high-frequency/lithographic or linear/watercolour — which decides whether its technique transfers at all' },
  { key: 'sightline', label: '定动线', states: 'where the eye lands first and the path it travels' },
  { key: 'lightAxis', label: '定光轴', states: 'where the light comes from' },
  { key: 'tonalBands', label: '分明暗', states: 'the highlight / midtone / shadow zones, decided before objects are placed' },
  { key: 'roles', label: '分角色', states: 'each object as label / prop / device / annotation' },
  { key: 'saturation', label: '分饱和', states: 'what is saturated and where — saturation belongs in the dark zones, highlights at the edges' },
  { key: 'interleave', label: '交错', states: 'how high- and low-reflectance, thick and thin alternate' },
  { key: 'form', label: '造型', states: 'the shape is right before any effect is applied' },
  { key: 'effects', label: '效果', states: 'the paired outer/inner shadow and the direction they follow' },
  { key: 'texture', label: '质感', states: 'detail inside each object, not more objects' },
]

/** Steps that may legitimately be inapplicable, and the reason to give when marking one so. */
export const INAPPLICABLE_ALLOWED = new Set([
  'language', 'sightline', 'tonalBands', 'roles', 'saturation', 'interleave', 'form', 'effects', 'texture',
])

/**
 * Validate a `gates` value.
 *
 * Returns a list of problems, each a sentence naming the key, what was expected, and what was
 * found. An empty list means the declaration is usable; it does NOT mean the design is good —
 * these checks read the declaration, never the picture.
 *
 * @param {unknown} gates the scene's `gates` value
 * @returns {{ok: boolean, problems: string[], gates: object|null}}
 */
export function validateGates(gates) {
  const problems = []
  if (gates === undefined || gates === null) {
    return {
      ok: false,
      problems: [
        'no `gates` block. The renderer refuses a scene that never declared its focus, its light ' +
        `axis, its layer order and its decision order, because everything placed before those are ` +
        `declared is placed blind. Required keys: ${REQUIRED_GATE_KEYS.join(', ')}.`,
      ],
      gates: null,
    }
  }
  if (typeof gates !== 'object' || Array.isArray(gates)) {
    return { ok: false, problems: [`\`gates\` must be an object, got ${Array.isArray(gates) ? 'an array' : typeof gates}`], gates: null }
  }

  for (const key of REQUIRED_GATE_KEYS) {
    const v = gates[key]
    if (v === undefined || v === null) {
      problems.push(`\`gates.${key}\` is missing`)
      continue
    }
    if (key === 'sequence') {
      problems.push(...validateSequence(v))
      continue
    }
    if (key === 'layers') {
      if (!Array.isArray(v) || v.length === 0) {
        problems.push('`gates.layers` must be a non-empty array of id prefixes in draw order')
      } else if (v.some((x) => typeof x !== 'string' || x.trim() === '')) {
        problems.push('`gates.layers` must contain only non-empty strings')
      } else if (v.length < 2) {
        // One prefix cannot express an order, and the whole point of this key is the ORDER.
        problems.push(`\`gates.layers\` has ${v.length} entry — an order needs at least two, otherwise it constrains nothing`)
      }
    } else if (key === 'accentBand') {
      if (!Array.isArray(v) || v.length !== 2 || v.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
        problems.push('`gates.accentBand` must be [lo, hi] as two finite numbers, e.g. [0, 0.05]')
      } else if (v[0] > v[1]) {
        problems.push(`\`gates.accentBand\` is inverted: [${v[0]}, ${v[1]}]`)
      }
    } else if (typeof v !== 'string' || v.trim() === '') {
      problems.push(`\`gates.${key}\` must be a non-empty string stating the decision, not a placeholder`)
    }
  }

  // Optional keys are checked only when present, so a scene is never punished for omitting one.
  if (gates.forbiddenZones !== undefined && !Array.isArray(gates.forbiddenZones)) {
    problems.push('`gates.forbiddenZones` must be an array of { name, x, y, w, h }')
  }
  if (gates.allowTranslucent !== undefined && !Array.isArray(gates.allowTranslucent)) {
    problems.push('`gates.allowTranslucent` must be an array of layer ids')
  }
  if (gates.groundEntities !== undefined && !Array.isArray(gates.groundEntities)) {
    problems.push('`gates.groundEntities` must be an array of layer ids that are "what the figure stands on"')
  }
  if (gates.sheetRoles !== undefined && !Array.isArray(gates.sheetRoles)) {
    problems.push('`gates.sheetRoles` must be an array of layer ids that represent a physical sheet, or of { id, role } records')
  }

  return { ok: problems.length === 0, problems, gates }
}

/**
 * The decision order, checked as an order.
 *
 * Two shapes are accepted, and both are deliberate:
 *
 *   sequence: ["what is on the page", "high-frequency litho", ..., { step: "saturation", why: "monochrome, no saturation decision" }]
 *   sequence: { inventory: "...", language: { why: "..." }, ... }
 *
 * The array form reads as the sequence it is; the object form survives reordering by a formatter.
 * Either way every canonical step must be accounted for — stated, or marked inapplicable WITH a
 * reason. A step that is simply absent is the failure this check exists for.
 */
export function validateSequence(v) {
  const problems = []
  const stated = new Map()
  let positions = null

  if (Array.isArray(v)) {
    if (v.length === 0) return ['`gates.sequence` is empty — it must account for every step of the decision order']

    // THE ARRAY FORM'S MEANING **IS** THE ORDER, so entry i is step i and nothing else.
    //
    // The first version of this let an entry carry a `step` name in the array, which made the check
    // circular: with position defining the name, moving a step is invisible, because the thing that
    // moved is read as whatever now sits at that position. Tested and confirmed — the light axis
    // moved to the last slot validated as correct. So an entry is a string, and a caller who wants
    // to name a step uses the object form, where names are explicit and order is checked against
    // them.
    if (v.length > DECISION_SEQUENCE.length) {
      problems.push(`\`gates.sequence\` has ${v.length} entries but the order has ${DECISION_SEQUENCE.length} steps`)
    }
    for (const [i, entry] of v.entries()) {
      const step = DECISION_SEQUENCE[i]
      if (step === undefined) {
        // Reported once and the loop CONTINUES rather than breaking. An earlier version broke here,
        // and then the accounting pass below reported a step as unaccounted-for that the extra entry
        // had merely displaced — two problems where there is one, and the second was false.
        problems.push(`\`gates.sequence\` has more entries than the order has steps (${DECISION_SEQUENCE.length})`)
        continue
      }
      if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
        // THE OBJECT FORM IS HOW A STEP IS MARKED INAPPLICABLE. It sits in the array at the step's
        // own position — the position IS the name here — so `{ step: 'x' }` is not required, and
        // demanding it would reject the one form this branch exists to accept. (It did, on the
        // first run of the engine's own storyboard scene: three inapplicable steps were refused
        // with "must be a string", which is the gate being wrong about its own contract.)
        stated.set(step.key, entry)
        continue
      }
      stated.set(step.key, entry)
    }
  } else if (v !== null && typeof v === 'object') {
    const known = new Set(DECISION_SEQUENCE.map((s) => s.key))
    // Named form: order comes from the names, so it CAN be checked, and it is.
    positions = []
    for (const [key, value] of Object.entries(v)) {
      if (!known.has(key)) {
        problems.push(`\`gates.sequence.${key}\` is not a step of the decision order: ${DECISION_SEQUENCE.map((s) => s.key).join(' → ')}`)
        continue
      }
      stated.set(key, value)
      positions.push({ key, canonical: DECISION_SEQUENCE.findIndex((s) => s.key === key) })
    }
    for (let i = 1; i < positions.length; i++) {
      if (positions[i].canonical < positions[i - 1].canonical) {
        problems.push(
          `\`gates.sequence\` is out of order: "${positions[i].key}" is step ${positions[i].canonical + 1} but is written after ` +
          `"${positions[i - 1].key}" (step ${positions[i - 1].canonical + 1}). The light axis settles before anything is placed — ` +
          'get the shadow direction wrong at the start and everything after it is wrong.',
        )
        break
      }
    }
  } else {
    return ['`gates.sequence` must be an array of statements in order, or an object keyed by step name']
  }

  // Every step accounted for, whichever shape the caller used.
  for (const [i, step] of DECISION_SEQUENCE.entries()) {
    if (!stated.has(step.key)) {
      problems.push(
        `\`gates.sequence\` does not account for step ${i + 1} (${step.label} / ${step.key}): ${step.states}. ` +
        'State it, or mark it inapplicable with a reason — an absent step and an unconsidered one are indistinguishable.',
      )
      continue
    }
    const value = stated.get(step.key)
    const looksInapplicable = value !== null && typeof value === 'object'
    if (looksInapplicable) {
      const why = value.why
      if (typeof why !== 'string' || why.trim() === '') {
        problems.push(`\`gates.sequence.${step.key}\` is marked inapplicable without a reason — say why it does not apply here`)
      }
      if (!INAPPLICABLE_ALLOWED.has(step.key)) {
        problems.push(
          `\`gates.sequence.${step.key}\` (${step.label}) cannot be skipped: it is ${step.states}. ` +
          'It is the step whose omission is least visible afterwards — a page with no decided light axis still renders.',
        )
      }
    } else if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`\`gates.sequence.${step.key}\` must state the decision`)
    }
  }

  return problems
}

/**
 * The message the renderer prints when it refuses. Kept here rather than in the CLI so the
 * wording is the same wherever the refusal happens.
 *
 * It names the *consequence* of each missing key rather than repeating the schema. A person
 * who has just been blocked needs to know what to decide, not what the type of a field is.
 */
export function refusalMessage(problems, scenePath) {
  const lines = [
    `render refused: the scene declares no usable \`gates\` block${scenePath === undefined ? '' : ` (${scenePath})`}`,
    '',
    ...problems.map((p) => `  · ${p}`),
    '',
    'Answer these in the scene before building anything, because everything placed before them is placed blind:',
    '  focus        the ONE thing the reader sees, and what it competes with',
    '  lightAxis    where the light comes from',
    '  layers       the draw order as id prefixes, in sequence — the gate compares it to the real list',
    '  drawingRule  the rule that generates each group; a group without a stated rule is not designed',
    '  accentBand   the accent\'s allowed flat-fill share, e.g. [0, 0.05]',
    '',
    'And the DECISION ORDER, as `sequence` — each step stated, or marked { step, why } where it genuinely does not apply:',
    ...DECISION_SEQUENCE.map((s, i) => `  ${String(i + 1).padStart(2)}. ${s.key.padEnd(11)} ${s.label} — ${s.states}`),
    '',
    'The order is not decoration. The light axis settles before anything is placed: get the shadow',
    'direction wrong at the start and everything after it is wrong, and by the time it shows, every',
    'element already has a size and a position. A step marked inapplicable needs its reason, because',
    'an absent step and an unconsidered one are indistinguishable from the outside.',
    '',
    'Optional, and checked only when present: forbiddenZones, allowTranslucent, groundEntities, sheetRoles.',
    '',
    'If this is an engine fixture or a throwaway probe rather than a design, pass --no-gates.',
  ]
  return lines.join('\n')
}
