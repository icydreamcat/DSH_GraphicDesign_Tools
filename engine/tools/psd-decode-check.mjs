/**
 * psd-decode-check — decode the flat composite out of a PSD and prove it is a
 * real image.
 *
 * Why this and not another structural audit: `psd-audit.mjs` walks lengths and
 * totals, and those all balanced. It still did not prove the file was OPENABLE,
 * because Photoshop parses the composite image data first and refuses the file
 * if that section is malformed. So this decodes it the way a reader must:
 *
 *   compression word, then for each plane a table of `height` two-byte row
 *   counts, then each plane's PackBits body, rows consumed in order.
 *
 * The PackBits decoder here is written from the spec and deliberately strict —
 * a control byte that would run past the end of a row is an error, not a
 * clamped value. If this fails, no reader on earth will open the file, and the
 * failure tells us which byte is wrong rather than that something is.
 *
 * Usage: node tools/psd-decode-check.mjs <file.psd> [out.png]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createCanvas } from '@napi-rs/canvas'

const buf = readFileSync(process.argv[2])
const OUT = process.argv[3]
const be16 = (o) => (buf[o] << 8) | buf[o + 1]
const be32 = (o) => ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0

const channels = be16(12)
const H = be32(14)
const W = be32(18)
const depth = be16(22)
const mode = be16(24)
console.log(`header: ${W}x${H}, ${channels} channels, ${depth}bpc, mode ${mode}`)
if (depth !== 8) throw new Error(`depth ${depth} not supported by this checker`)
if (channels !== 3 && channels !== 4) throw new Error(`channels ${channels} not supported`)

const cmLen = be32(26), resLen = be32(30)
const lmOff = 34 + cmLen + resLen
const lmLen = be32(lmOff)
let p = lmOff + 4 + lmLen
console.log('composite starts at', p, '| file bytes', buf.length)

const compression = be16(p); p += 2
console.log('composite compression:', compression, '(0=raw, 1=RLE)')
const planes = channels

/** Strict PackBits: returns exactly `expect` bytes or throws. */
function unpack(src, offset, expect) {
  const out = Buffer.alloc(expect)
  let i = offset
  let o = 0
  while (o < expect) {
    if (i >= src.length) throw new Error(`ran past end of body at output ${o}/${expect}`)
    const n = src[i++]
    if (n < 128) {
      const count = n + 1
      if (o + count > expect) throw new Error(`literal run of ${count} overflows the row at ${o}/${expect}`)
      if (i + count > src.length) throw new Error('literal run past end of file')
      src.copy(out, o, i, i + count)
      i += count; o += count
    } else if (n > 128) {
      const count = 257 - n
      if (o + count > expect) throw new Error(`repeat run of ${count} overflows the row at ${o}/${expect}`)
      if (i >= src.length) throw new Error('repeat run past end of file')
      out.fill(src[i], o, o + count)
      i++; o += count
    }
    // n === 128 is a no-op by definition
  }
  return { out, consumed: i - offset }
}

let planesData
let decodeFailed = false
if (compression === 1) {
  const rowCounts = []
  for (let c = 0; c < planes; c++) {
    const rc = new Array(H)
    for (let y = 0; y < H; y++) { rc[y] = be16(p); p += 2 }
    rowCounts.push(rc)
  }
  console.log('row-count tables read; body starts at', p)
  planesData = []
  decodeFailed = false
  for (let c = 0; c < planes && !decodeFailed; c++) {
    const plane = Buffer.alloc(W * H)
    let rowBytesConsumed = 0
    let firstBad = null
    for (let y = 0; y < H; y++) {
      const declared = rowCounts[c][y]
      try {
        const { out, consumed } = unpack(buf, p + rowBytesConsumed, W)
        out.copy(plane, y * W)
        if (consumed !== declared && firstBad === null) {
          firstBad = `plane ${c} row ${y}: table says ${declared} bytes, decoder consumed ${consumed}`
        }
        rowBytesConsumed += declared
      } catch (e) {
        console.log(`  DECODE FAILURE plane ${c} row ${y}: ${e.message}`)
        process.exitCode = 1
        decodeFailed = true
        break
      }
    }
    if (decodeFailed) break
    console.log(`plane ${c}: decoded ${W}x${H}, consumed ${rowBytesConsumed} bytes`, firstBad ? `| FIRST ROW-COUNT MISMATCH: ${firstBad}` : '| row counts agree with decoder')
    planesData.push(plane)
    p += rowBytesConsumed
  }
} else if (compression === 0) {
  planesData = []
  for (let c = 0; c < planes; c++) {
    planesData.push(buf.subarray(p, p + W * H))
    p += W * H
  }
} else {
  throw new Error(`composite compression ${compression} is not 0 or 1 — Photoshop rejects this file`)
}

const tail = buf.length - p
console.log('bytes left after composite:', tail, tail === 0 ? '(exact)' : '(should be 0)')

if (OUT) {
  const cv = createCanvas(W, H)
  const ctx = cv.getContext('2d')
  const id = ctx.createImageData(W, H)
  for (let i = 0; i < W * H; i++) {
    id.data[i * 4] = planesData[0][i]
    id.data[i * 4 + 1] = planesData[1][i]
    id.data[i * 4 + 2] = planesData[2][i]
    id.data[i * 4 + 3] = planesData[3] === undefined ? 255 : planesData[3][i]
  }
  ctx.putImageData(id, 0, 0)
  writeFileSync(OUT, cv.toBuffer('image/png'))
  console.log('wrote', OUT)
}
