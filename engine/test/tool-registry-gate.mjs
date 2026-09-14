/**
 * Register the design tools through a registry that validates EXACTLY like DSH's,
 * to find a fault the fake registry cannot see.
 *
 * WHY
 * ---
 * Everything verified so far passes: six tools, correct schemas, a clean mount,
 * and DSH's own compilers returning `type: 'object'`. Yet a live session still
 * reports, from the provider:
 *
 *   Invalid schema for function 'design_analyze':
 *   schema must be a JSON Schema of 'type: "object"', got 'type: null'
 *
 * and it survived the schemas being reduced to nothing but `type` + `description`
 * per property — which is the shape the built-in tools use and which has never
 * failed. That means my local checks are measuring a path that differs from the
 * one that fails.
 *
 * The difference is that my earlier harness used `tools: { register(t) { push } }`
 * — a stub that accepts anything. This uses the registry's real gate
 * (`output.render` must be a function, and `assertSupportedJsonSchema` must pass),
 * then projects the result the way the provider adapter does, and reports the
 * first tool whose API-facing schema is not a valid object. If the fault is
 * visible at all in-process, this finds it.
 */
import { readFileSync, readdirSync } from 'node:fs'

const DSH_TOOLS = 'file:///C:/Users/iced%27re%27a%27m/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js'
const PRESET_DIR = "C:/Users/iced're'a'm/.dsh/.agent-presets/design"

const { assertSupportedJsonSchema, validateJsonSchemaValue } = await import(DSH_TOOLS)

const yaml = readFileSync(`${PRESET_DIR}/agent.cordis.yml`, 'utf8')
const m = /- id: design-tools\s*\n\s*name:\s*\.\/([^\s]+)/.exec(yaml)
if (m === null) throw new Error('cannot find the design-tools row')
const moduleName = m[1]
console.log(`module: ${moduleName}`)
console.log(`siblings: ${readdirSync(PRESET_DIR).filter((f) => /^design-tools.*\.mjs$/.test(f)).join(', ')}`)

/** A registry stub that enforces the same gate DSH's register() does. */
const registered = []
const strictCtx = {
  tools: {
    register(definition) {
      const name = definition.name
      const output = definition.output
      // Verbatim from dsh-tools register().
      if (output === undefined || typeof output !== 'object' || typeof output.render !== 'function' ||
          (output.presentationMeta !== undefined && typeof output.presentationMeta !== 'function')) {
        throw new TypeError(`tool "${name}" must declare output { schema, render, presentationMeta? }`)
      }
      assertSupportedJsonSchema(output.schema)
      if (typeof definition.execute !== 'function') throw new TypeError(`tool "${name}" has no execute`)
      registered.push(definition)
    },
  },
}

const plugin = await import(`file:///${PRESET_DIR}/${moduleName}`)
plugin.apply(strictCtx, { engineDir: 'D:/DSH_GDT/DSH_GraphicDesign_Tools/engine' })
console.log(`registered through the strict gate: ${registered.length}`)

/** Project exactly as the provider adapter does: { type, function: { name, description, parameters } }. */
console.log('\nAPI-facing projection:')
let bad = 0
for (const t of registered) {
  const wire = {
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }
  const p = wire.function.parameters
  const problems = []
  if (p === undefined || p === null) problems.push('parameters is null/undefined')
  else if (typeof p !== 'object') problems.push(`parameters is ${typeof p}`)
  else if (p.type !== 'object') problems.push(`parameters.type is ${JSON.stringify(p.type)}`)
  else {
    // The API also requires properties to be objects; and a `null` anywhere in an
    // array-valued keyword is a common validator trip.
    for (const [k, v] of Object.entries(p.properties || {})) {
      if (v === null || typeof v !== 'object' || v.type === undefined) problems.push(`property ${k} malformed`)
    }
    if (p.additionalProperties === null) problems.push('additionalProperties is null')
  }
  // Round-trip through JSON, which is what actually crosses the boundary.
  let roundTripped = null
  try { roundTripped = JSON.parse(JSON.stringify(wire)) } catch (e) { problems.push(`not JSON-serializable: ${e.message}`) }
  if (roundTripped !== null && roundTripped.function.parameters.type !== 'object') {
    problems.push(`after JSON round-trip, parameters.type is ${JSON.stringify(roundTripped.function.parameters.type)}`)
  }
  if (problems.length > 0) {
    bad++
    console.log(`  FAIL  ${t.name}`)
    for (const x of problems) console.log(`          ${x}`)
    console.log(`          wire: ${JSON.stringify(wire).slice(0, 300)}`)
  } else {
    console.log(`  ok    ${t.name.padEnd(18)} parameters.type=object, ${Object.keys(p.properties || {}).length} propert(ies)`)
  }
}

// Prove a call still works with the schema as declared. `defineTool` validates a
// call with `validateJsonSchemaValue(compiledParameters, args)`, and the registry
// projects `parameters` verbatim through `snapshotJsonValue`, so the compiled
// schema IS the contract — validating against it is the same check the runtime
// performs. (Validating against the raw spec instead is what the built-in
// packages do at build time, not what happens on a call.)
console.log('\nexecute() reachable with declared arguments:')
const sample = {
  design_render: { scene: 'scenes/kv-timeline.json', out: 'out', name: 'probe', scale: 0.2 },
  design_analyze: { image: 'refs/timeline.webp', maxSide: 800 },
  design_critique: { image: 'out/selftest.png' },
  design_verify: { scene: 'scenes/kv-timeline.json', png: 'out/selftest.png' },
  design_system: { what: 'fonts' },
  design_photoshop: { action: 'status' },
  design_palette: { what: 'presets' },
  design_tool: { action: 'list' },
  design_palette: { what: 'presets' },
}
for (const t of registered) {
  const problems = []
  // The registry snapshots `parameters` as lossless JSON, so it must survive a
  // JSON round-trip unchanged — a function or class instance in there would make
  // the projection fail at dispatch.
  let roundTrippedParameters = null
  try { roundTrippedParameters = JSON.parse(JSON.stringify(t.parameters)) } catch (e) { problems.push(`parameters not JSON-serializable: ${e.message}`) }
  if (roundTrippedParameters !== null && roundTrippedParameters.type !== 'object') problems.push('parameters lost its type through JSON')
  const valid = validateJsonSchemaValue(t.parameters, sample[t.name], '')
  if (valid.length > 0) problems.push(`valid args rejected: ${valid.join('; ')}`)
  // A missing required argument must be refused.
  if (Array.isArray(t.parameters.required) && t.parameters.required.length > 0) {
    const empty = validateJsonSchemaValue(t.parameters, {}, '')
    if (!empty.some((v) => /missing required property/.test(v))) {
      problems.push('a call with no arguments was not refused')
    }
  }
  console.log(problems.length
    ? `  FAIL  ${t.name}: ${problems.join('; ')}`
    : `  ok    ${t.name.padEnd(18)} valid args accepted; required enforced`)
}

console.log(`\n${registered.length - bad}/${registered.length} tools project to a valid API schema`)
process.exit(bad === 0 ? 0 : 1)
