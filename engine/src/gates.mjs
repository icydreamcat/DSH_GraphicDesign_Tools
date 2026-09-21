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
export const REQUIRED_GATE_KEYS = ['focus', 'lightAxis', 'layers', 'drawingRule', 'accentBand']

/** Optional keys, listed so the error message can mention them without pretending they are required. */
export const OPTIONAL_GATE_KEYS = ['forbiddenZones', 'allowTranslucent', 'groundEntities', 'sheetRoles']

/**
 * Validate a `gates` block.
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
        `axis and its layer order, because everything placed before those are declared is placed ` +
        `blind. Required keys: ${REQUIRED_GATE_KEYS.join(', ')}.`,
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
    'Optional, and checked only when present: forbiddenZones, allowTranslucent, groundEntities, sheetRoles.',
    '',
    'If this is an engine fixture or a throwaway probe rather than a design, pass --no-gates.',
  ]
  return lines.join('\n')
}
