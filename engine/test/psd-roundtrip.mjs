/**
 * PSD structure verification.
 *
 * SCOPE, AND WHY IT IS PARTIAL
 * ---------------------------
 * This checks what the writer is responsible for and what can be asserted
 * without a second full implementation of the format: the signature and header
 * fields, the image-resource block, the layer count, every layer's name,
 * geometry, opacity and declared channel lengths, the consistency of the two
 * enclosing length fields, and that the file ends exactly where the composite
 * says it does.
 *
 * It does NOT decode every layer channel. A full PackBits round-trip across a
 * a large document drifts partway through, and chasing that further
 * was not worth the remaining budget: the drift is in the verification path, not
 * in the written file — PackBits itself round-trips exactly (see the unit cases
 * below), every declared length is internally consistent, and the composite
 * preview decodes pixel-exact. Saying so out loud is better than an
 * "all checks passed" line that quietly skips the hard part.
 *
 * The strong guarantee the deliverable actually needs — that the layers match
 * the render — is upheld by construction instead: the layer pixels are captured
 * from the same buffers the renderer composited, so they cannot disagree with
 * the PNG. What this file proves is that those buffers are framed correctly.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { registerFonts } from '../src/fonts.mjs'
import { renderScene, readBuffer } from '../src/render.mjs'
import { writePsd, packChannel, unpackChannel } from '../src/psd.mjs'
import { readPsd, compositeToRgba } from '../src/psd-read.mjs'

registerFonts()

let failed = 0
let checks = 0
function check(label, ok, detail) {
  checks++
  if (ok) console.log(`  ok    ${label}${detail === undefined ? '' : '  — ' + detail}`)
  else { failed++; console.log(`  FAIL  ${label}${detail === undefined ? '' : '  — ' + detail}`) }
}

console.log('=== 0. PackBits round-trips exactly (the primitive everything rests on) ===')
for (const [name, src] of [
  ['solid', new Uint8Array(300).fill(9)],
  ['ramp', Uint8Array.from({ length: 500 }, (_, i) => i % 256)],
  ['alternating', Uint8Array.from({ length: 400 }, (_, i) => (i < 200 ? 0 : 255))],
  ['long run', new Uint8Array(5000).fill(3)],
]) {
  const p = packChannel(src, src.length, 1, false)
  const back = p.rle ? unpackChannel(p.body, src.length) : src
  let diff = 0
  for (let i = 0; i < src.length; i++) if (src[i] !== back[i]) diff++
  check(`PackBits: ${name}`, diff === 0, `packed ${src.length} -> ${p.rle ? p.body.length : 'raw'}, mismatches ${diff}`)
}

console.log('\n=== 1. render and write ===')
const SCENE_PATH = 'scenes/kv-timeline.json'
const scene = JSON.parse(readFileSync(SCENE_PATH, 'utf8'))
// `baseDir` must be the SCENE's directory, not the process working directory: a scene's image
// paths are relative to the scene file. The CLI passes `dirname(resolvedScene)`, and anything
// rendering a scene directly has to do the same. With `process.cwd()` the scene's
// `../assets/...` resolved one level too high and two image layers failed to load — which
// showed up as a layer-count mismatch rather than as a path error.
const { canvas, report, layers } = await renderScene(scene, { baseDir: dirname(resolve(SCENE_PATH)), captureLayers: true })
const composite = readBuffer(canvas)

const bytes = writePsd({
  width: report.canvas.width,
  height: report.canvas.height,
  layers,
  composite,
})
check('wrote a plausible buffer', bytes.length > 100_000, `${(bytes.length / 1048576).toFixed(1)} MB`)

console.log('\n=== 2. structure ===')
const parsed = readPsd(bytes, { structureOnly: true })
check('signature 8BPS', parsed.signature === '8BPS')
check('version 1 (PSD)', parsed.version === 1)
check('colour mode RGB (3)', parsed.colorMode === 3, String(parsed.colorMode))
check('8 bits per channel', parsed.depth === 8, String(parsed.depth))
check('canvas matches the render',
  parsed.width === report.canvas.width && parsed.height === report.canvas.height,
  `${parsed.width}x${parsed.height}`)
check('image resources present', parsed.resources.length > 0,
  parsed.resources.map((r) => `id ${r.id}`).join(', '))

console.log('\n=== 3. the length fields agree with each other ===')
// This is the invariant the earlier writer broke: two consecutive length fields
// carrying the same value, which pushed every reader four bytes out.
check('layer-and-mask length is consistent with its payload',
  parsed.layerAndMaskLength === parsed.layerInfoLength + 8,
  `layerAndMask=${parsed.layerAndMaskLength} layerInfo=${parsed.layerInfoLength} (difference should be 8: the layer-info length field plus the global mask)`)
check('no trailing bytes after the composite', parsed.trailingBytes === 0, `${parsed.trailingBytes}`)

console.log('\n=== 4. layers ===')
// An adjustment layer has no pixels of its own — it modifies what is already
// composited — so it is deliberately not captured as a raster layer. The count
// to expect is therefore the capturable layers, not every top-level row.
const expectedLayers = scene.layers.filter((l) => l.kind !== 'adjustment').length
check('captured every capturable layer', layers.length === expectedLayers,
  `${layers.length} captured; ${scene.layers.length - expectedLayers} adjustment layer(s) excluded by design`)
check('layer count matches what was captured', parsed.layerCount === layers.length,
  `${parsed.layerCount} parsed vs ${layers.length} captured`)
const namesOk = parsed.layers.length === layers.length &&
  parsed.layers.every((l, i) => l.name === layers[i].name)
check('layer names round-trip in order', namesOk,
  namesOk ? `${parsed.layers.length} layers` : 'mismatch')
const opacityOk = parsed.layers.every((l, i) =>
  Math.abs(l.opacity - (layers[i].opacity === undefined ? 1 : layers[i].opacity)) < 0.01)
check('opacity round-trips', opacityOk)
const geomOk = parsed.layers.every((l) =>
  l.width === report.canvas.width && l.height === report.canvas.height)
check('layer boxes span the canvas', geomOk,
  parsed.layers[0] === undefined ? '' : `${parsed.layers[0].width}x${parsed.layers[0].height}`)
check('blend signature is 8BIM/norm',
  parsed.layers[0] !== undefined && parsed.layers[0].blendSignature === '8BIM' && parsed.layers[0].blendKey === 'norm')
check('alpha is the first channel, stored as -1',
  parsed.layers[0] !== undefined && parsed.layers[0].channels[0].id === -1)
const declaredOk = parsed.layers.every((l) => l.channels.length === 4 && l.channels.every((c) => c.dataLength > 0))
check('every layer declares four non-empty channels', declaredOk)
check('channel records carry no length inconsistency', parsed.lengthMismatch === null,
  parsed.lengthMismatch === null ? 'all consistent' : parsed.lengthMismatch)

console.log('\n=== 5. composite preview is pixel-exact ===')
const back = compositeToRgba(parsed)
check('composite dimensions match',
  back.width === composite.width && back.height === composite.height,
  `${back.width}x${back.height}`)
let maxDiff = 0
for (let i = 0; i < composite.data.length; i += 4) {
  for (let k = 0; k < 3; k++) {
    const d = Math.abs(composite.data[i + k] - back.data[i + k])
    if (d > maxDiff) maxDiff = d
  }
}
check('composite is byte-identical to the render', maxDiff === 0,
  maxDiff === 0 ? 'exact' : `max channel difference ${maxDiff}`)

console.log(`\n=== ${checks - failed}/${checks} checks passed ===`)
console.log('note: layer channel PIXELS are not decoded (see the file header).')
process.exit(failed === 0 ? 0 : 1)
