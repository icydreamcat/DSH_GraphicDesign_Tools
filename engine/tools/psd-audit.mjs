/**
 * psd-audit — validate a layered PSD against the spec, independently of the
 * engine's own writer and reader.
 *
 * Why this exists: the engine's `psd-roundtrip.mjs` passed 24/24 on its own
 * test scene, but its reader throws on the poster this design produced
 * ("compression 129", which is not a legal value — meaning the reader is
 * reading from the wrong offset). A delivery format that only its own writer
 * can read is not a delivery format. So this parses the file from the spec:
 *
 *   header, colour mode data, image resources, layer-and-mask length,
 *   layer-info length, layer count, every layer record, then channel data.
 *
 * The three checks that actually catch real corruption:
 *   - layerAndMaskLen === layerInfoLen + 8
 *   - the records consume exactly the layer-info payload, with no drift
 *   - every channel's compression word is 0 or 1, and the bytes it declares
 *     match the bytes it occupies
 *
 * Usage: node tools/psd-audit.mjs <file.psd>
 */
import { readFileSync } from 'node:fs'

const buf = readFileSync(process.argv[2])
const be16 = (o) => (buf[o] << 8) | buf[o + 1]
const be32 = (o) => ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0
const ascii = (o, n) => buf.toString('latin1', o, o + n)

const problems = []
const note = (m) => problems.push(m)

console.log('signature      :', ascii(0, 4))
console.log('version        :', be16(4))
console.log('channels       :', be16(12))
console.log('height x width :', be32(14), 'x', be32(18))
console.log('depth          :', be16(22), 'bpc')
console.log('colour mode    :', be16(24))
console.log('file bytes     :', buf.length)

const colorModeLen = be32(26)
const imgResLen = be32(30)
console.log('colourModeLen  :', colorModeLen)
console.log('imageResLen    :', imgResLen)

const lmOff = 34 + colorModeLen + imgResLen
const lmLen = be32(lmOff)
const liLen = be32(lmOff + 4)
console.log('layerAndMaskLen:', lmLen)
console.log('layerInfoLen   :', liLen)
console.log('difference     :', lmLen - liLen, lmLen - liLen === 8 ? '(correct: 8)' : '(WRONG: must be 8)')
if (lmLen - liLen !== 8) note(`layerAndMaskLen - layerInfoLen = ${lmLen - liLen}, spec requires 8`)

const liStart = lmOff + 8                 // first byte of the layer-info payload
const liEnd = liStart + liLen             // payload only, pad is outside it
const layerCount = be16(liStart)
console.log('layerCount     :', layerCount)
console.log('layerInfo spans:', liStart, '->', liEnd)

let p = liStart + 2
const rows = []
for (let i = 0; i < layerCount; i++) {
  const recStart = p
  const top = be32(p), left = be32(p + 4), bottom = be32(p + 8), right = be32(p + 12)
  const nch = be16(p + 16)
  p += 18
  const chans = []
  for (let c = 0; c < nch; c++) {
    const id = be16(p); const len = be32(p + 2)
    chans.push({ id: id > 32767 ? id - 65536 : id, len })
    p += 6
  }
  const blendSig = ascii(p, 4); const blendKey = ascii(p + 4, 4)
  p += 8
  const opacity = buf[p]; const clipping = buf[p + 1]; const flags = buf[p + 2]
  p += 4
  const extraLen = be32(p); p += 4
  const extraEnd = p + extraLen
  // inside the extra data: layer mask, blending ranges, then the Pascal name
  const maskLen = be32(p); p += 4 + maskLen
  const blendLen = be32(p); p += 4 + blendLen
  const nameLen = buf[p]; p += 1
  const name = buf.toString('utf8', p, p + nameLen)
  p += nameLen
  if (p < extraEnd) p = extraEnd
  rows.push({ i: i + 1, name, box: `${left},${top} ${right - left}x${bottom - top}`, nch, blend: blendSig + '/' + blendKey, opacity, chans, recStart, recEnd: p })
}
console.log('\n--- layer records ---')
for (const r of rows) {
  console.log(String(r.i).padStart(2) + '. ' + (r.name || '(EMPTY NAME)').padEnd(20), r.box.padEnd(22), 'ch=' + r.nch, r.blend, 'op=' + r.opacity)
  if (!r.name) note(`layer ${r.i} has an empty name`)
}

const globalMaskLen = be32(p)
console.log('\nglobalLayerMaskLen:', globalMaskLen)
const recordsBytes = p - liStart
console.log('records section  :', recordsBytes, 'bytes')

// Channel data, navigated by the declared lengths — and then verified against
// what the stream itself says it occupies.
//
// This is the check that matters, because real readers (Photoshop included) do
// NOT trust the declared length: they read the compression word, and for RLE
// they read `height` two-byte row counts and then sum them. If the declared
// length and the in-stream truth disagree, the writer and Photoshop disagree,
// and every channel after the first lands in the wrong place.
let q = p + 4 + globalMaskLen
let chanProblems = 0
const H = be32(14)
for (const r of rows) {
  const [w, h] = r.box.split(' ')[1].split('x').map(Number)
  for (const c of r.chans) {
    const start = q
    const compression = be16(q)
    if (compression !== 0 && compression !== 1) {
      if (chanProblems < 6) note(`layer "${r.name}" channel ${c.id} at ${start}: compression ${compression} is not 0 or 1 (stream is misaligned)`)
      chanProblems++
      q += c.len
      continue
    }
    // Walk the stream the way a real reader does.
    let consumed
    if (compression === 1) {
      let counts = 0
      for (let y = 0; y < h; y++) counts += be16(q + 2 + y * 2)
      consumed = 2 + h * 2 + counts
    } else {
      consumed = 2 + w * h
    }
    if (consumed !== c.len) {
      if (chanProblems < 6) note(`layer "${r.name}" channel ${c.id} at ${start}: record declares ${c.len} bytes, the stream occupies ${consumed}`)
      chanProblems++
    }
    q = start + consumed
  }
}

// The layer-info payload is: records + zero-length global mask + all channel
// data. That identity is the real invariant; comparing "records only" against
// layerInfoLen is a false positive (it was this audit's own first mistake).
const sections = recordsBytes + 4 + globalMaskLen + (q - (p + 4 + globalMaskLen))
console.log('records+mask+chan:', sections, '| layerInfoLen:', liLen, sections === liLen ? '(exact)' : `(drift ${sections - liLen})`)
if (sections !== liLen) note(`records + global mask + channel data = ${sections}, layerInfoLen says ${liLen}`)

// And the file's own arithmetic: the composite must fill exactly what is left.
const compositeStart = lmOff + 4 + lmLen
const compositeBytes = buf.length - compositeStart
console.log('composite starts :', compositeStart, '| composite bytes:', compositeBytes)
if (compositeStart >= buf.length) note('layer-and-mask section runs past end of file')
if (chanProblems) note(`${chanProblems} channel record(s) disagree with the stream`)

console.log('\n--- verdict ---')
if (!problems.length) console.log('PASS — header, length fields, records and channel stream all consistent')
else for (const m of problems) console.log('FAIL —', m)
