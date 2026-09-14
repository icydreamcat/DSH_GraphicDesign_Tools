/**
 * Verify every design tool declares schemas DSH can actually use.
 *
 * WHAT THIS GUARDS, AND WHY IT IS WRITTEN THIS WAY
 * ------------------------------------------------
 * A live session failed repeatedly with:
 *
 *   Invalid schema for function 'design_analyze':
 *   schema must be a JSON Schema of 'type: "object"', got 'type: null'
 *
 * The cause was that this preset called `ctx.tools.register({...})` with a RAW
 * ParameterSchemaSpec. `register()` does not compile a definition — it stores it
 * verbatim — and the built-in packages only look correct because they wrap their
 * literal in `defineTool({...})`, which performs the compilation. So the provider
 * received `{"image":{…}}` with no `type` at all, and reported it as `type: null`.
 *
 * Two checks follow, and both are needed:
 *
 *   1. `parameters` must already be COMPILED JSON Schema. Validate it as JSON
 *      Schema and do NOT pass it through the spec compiler — doing the latter is
 *      what made an earlier version of this test report a false failure.
 *   2. `output.schema` is a ValueSchemaSpec, so it IS compiled — and every nested
 *      object in it must declare `additionalProperties` explicitly.
 *
 * A mount check cannot catch either: `register()` accepts almost anything, and
 * the failure surfaces when the provider validates the request.
 */
import { readFileSync, readdirSync } from 'node:fs'

const DSH_TOOLS = 'file:///C:/Users/iced%27re%27a%27m/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js'
const PRESET_DIR = "C:/Users/iced're'a'm/.dsh/.agent-presets/design"

const yaml = readFileSync(`${PRESET_DIR}/agent.cordis.yml`, 'utf8')
const declared = /- id: design-tools\s*\n\s*name:\s*\.\/([^\s]+)/.exec(yaml)
if (declared === null) throw new Error('could not find the design-tools row in agent.cordis.yml')
const TOOL_FILE = declared[1]
console.log(`tool plugin (declared by the composition): ${TOOL_FILE}`)

const siblings = readdirSync(PRESET_DIR).filter((f) => /^design-tools.*\.mjs$/.test(f))
if (siblings.length > 1) {
  console.log(`WARNING: ${siblings.length} design-tools files present (${siblings.join(', ')}); the composition uses ${TOOL_FILE}`)
}

const { valueSchemaSpecToJsonSchema, assertSupportedJsonSchema, validateJsonSchemaValue } = await import(DSH_TOOLS)

// A registry stub enforcing the same gate DSH's register() does, so a tool that
// could not register fails here instead of in a live session.
const registered = []
const strictCtx = {
  tools: {
    register(definition) {
      const output = definition.output
      if (output === undefined || typeof output !== 'object' || typeof output.render !== 'function') {
        throw new TypeError(`tool "${definition.name}" must declare output { schema, render, presentationMeta? }`)
      }
      assertSupportedJsonSchema(output.schema)
      registered.push(definition)
    },
  },
}
const plugin = await import(`file:///${PRESET_DIR}/${TOOL_FILE}`)
if (typeof plugin.apply !== 'function') throw new Error(`${TOOL_FILE}: apply is not exported`)
plugin.apply(strictCtx, { engineDir: 'D:/DSH_GDT/DSH_GraphicDesign_Tools/engine' })

console.log(`tools registered: ${registered.length}`)
let failed = 0

console.log('\n1. output declares { schema, render }:')
for (const t of registered) {
  const out = t.output
  const ok = out !== undefined && typeof out === 'object' && typeof out.render === 'function' &&
    (out.presentationMeta === undefined || typeof out.presentationMeta === 'function')
  if (!ok) { failed++; console.log(`  FAIL  ${t.name}`) }
  else console.log(`  ok    ${t.name.padEnd(18)} output { schema, render }`)
}

console.log('\n2. parameters are COMPILED JSON Schema, not a raw spec:')
for (const t of registered) {
  const problems = []
  const p = t.parameters
  if (p === undefined || p === null || typeof p !== 'object') problems.push('parameters missing')
  else {
    if (p.type !== 'object') problems.push(`type is ${JSON.stringify(p.type)} — a raw ParameterSchemaSpec has no type`)
    if (p.properties === undefined || typeof p.properties !== 'object') problems.push('no properties object')
    for (const [k, v] of Object.entries(p.properties || {})) {
      if (v === null || typeof v !== 'object' || v.type === undefined) problems.push(`property ${k} has no type`)
    }
    // The registry projects parameters through a JSON snapshot, so the type must
    // survive a round-trip.
    const rt = JSON.parse(JSON.stringify(p))
    if (rt.type !== 'object') problems.push('type lost through JSON round-trip')
  }
  if (problems.length) { failed++; console.log(`  FAIL  ${t.name}: ${problems.join('; ')}`) }
  else console.log(`  ok    ${t.name.padEnd(18)} parameters.type=object, ${Object.keys(p.properties).length} propert(ies)`)
}

console.log('\n3. output schemas compile, every nested object open:')
for (const t of registered) {
  let json = null
  const problems = []
  try { json = valueSchemaSpecToJsonSchema(t.output.schema); assertSupportedJsonSchema(json) }
  catch (e) { problems.push(e.message) }
  if (json !== null) {
    const nested = []
    const walk = (node) => {
      if (node === null || typeof node !== 'object') return
      if (node.type === 'object' && node.properties !== undefined && node.additionalProperties === undefined) {
        nested.push(JSON.stringify(node).slice(0, 50))
      }
      for (const v of Object.values(node)) { if (Array.isArray(v)) v.forEach(walk); else walk(v) }
    }
    walk(json)
    if (json.type !== 'object') problems.push(`root type is ${JSON.stringify(json.type)}`)
    if (nested.length) problems.push(`${nested.length} nested object(s) without additionalProperties`)
  }
  if (problems.length) { failed++; console.log(`  FAIL  ${t.name}: ${problems.join('; ')}`) }
  else console.log(`  ok    ${t.name.padEnd(18)} output.type=object, nested objects open`)
}

console.log('\n4. declared arguments accepted, required ones enforced:')
// `validateJsonSchemaValue` RETURNS a list of violations rather than throwing, so
// an empty array means valid. Reading a returned array as "accepted" is what made
// an earlier version of this check report a false failure.
const SAMPLE = {
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
  const valid = validateJsonSchemaValue(t.parameters, SAMPLE[t.name], '')
  if (valid.length > 0) problems.push(`valid args rejected: ${valid.join('; ')}`)
  const required = Array.isArray(t.parameters.required) ? t.parameters.required : []
  if (required.length > 0) {
    const empty = validateJsonSchemaValue(t.parameters, {}, '')
    const enforced = empty.some((v) => /missing required property/.test(v))
    if (!enforced) problems.push(`a call with no arguments was not refused (violations: ${JSON.stringify(empty)})`)
  }
  if (problems.length) { failed++; console.log(`  FAIL  ${t.name}: ${problems.join('; ')}`) }
  else console.log(`  ok    ${t.name.padEnd(18)} args accepted${required.length === 0 ? '' : `, required=[${required.join(', ')}]`}`)
}

console.log(`\n${registered.length - failed}/${registered.length} tools are usable`)
// The expected COUNT is a floor, not an equality. It was pinned to `=== 6` when the
// preset declared six tools; `design_palette` and `design_tool` were added later and
// the guard silently turned the suite red while every tool still passed (8/8 usable,
// exit 1) — a stale expectation, reported as a real failure. Keep the floor so a
// plugin that registers NOTHING still fails loudly, without breaking on new tools.
const MIN_EXPECTED_TOOLS = 6
process.exit(failed === 0 && registered.length >= MIN_EXPECTED_TOOLS ? 0 : 1)
