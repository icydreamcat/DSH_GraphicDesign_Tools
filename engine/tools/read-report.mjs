/**
 * read-report — print a render report in a form worth reading.
 *
 * The engine writes a large JSON report, and PowerShell's ConvertFrom-Json
 * mangles its UTF-8 CJK into mojibake, which makes the text metrics useless
 * exactly where they matter most. Node reads it correctly, so this is the
 * reader: issues first, then every text layer's real drawn box, then anything
 * that fell off the canvas.
 */
import { readFileSync } from 'node:fs'

const p = process.argv[2]
const j = JSON.parse(readFileSync(p, 'utf8'))
const r = j.report ?? j
const v = j.verification ?? r.verification

console.log('canvas', r.canvas.width + 'x' + r.canvas.height, '| layers', r.layerCount)
console.log('stats', JSON.stringify(r.stats))

if (v) {
  console.log('\n--- verification ---')
  if (!v.issues.length) console.log('(no issues)')
  for (const i of v.issues) console.log(`[${i.severity}] ${i.code} :: ${i.message}`)
  if (v.metrics) {
    const m = v.metrics
    console.log('metrics:', JSON.stringify({
      primaryTypeRatio: m.primaryTypeRatio, elementCount: m.elementCount,
      meanOpacity: m.meanOpacity, heavyShare: m.heavyShare,
      chromaticElementCount: m.chromaticElementCount,
    }))
  }
}

const H = r.canvas.height, W = r.canvas.width
console.log('\n--- text layers (drawn box, from the renderer) ---')
for (const l of r.log) {
  if (l.step !== 'layer' || l.shape !== 'text') continue
  const d = l.drawn
  const flag = []
  if (d.overflow) flag.push('OVERFLOW')
  if (d.fontFallback) flag.push('FALLBACK')
  const box = d.block
  if (box) {
    if (box.y + box.h > H) flag.push('BELOW-PAGE')
    if (box.y < 0) flag.push('ABOVE-PAGE')
    if (box.x + box.w > W) flag.push('RIGHT-OF-PAGE')
  }
  // Ink extent, not advance extent: the first baseline sits at y + size*0.82
  // and a CJK em is one em wide and tall, so this is the box a reader sees.
  const inkTop = box ? Math.round(box.y) : null
  const inkBottom = box ? Math.round(box.y + box.h) : null
  // Vertical-setting layers report height/characters instead of a block, so
  // neither `block` nor `families` is guaranteed to exist.
  const fams = d.families === undefined ? (d.mode === 'vertical' ? `vertical ${d.characters}ch h=${Math.round(d.height)}` : '?') : d.families.join('+')
  console.log(
    `${l.id.padEnd(22)} ${String(d.fontSize).padStart(5)}px  y ${String(inkTop).padStart(5)}→${String(inkBottom).padStart(5)}`,
    ` x ${String(box?.x).padStart(5)} w ${String(box?.w).padStart(4)}`,
    ` lines ${d.lines} widest ${String(d.widest).padStart(7)}`,
    ` fam ${fams}`,
    flag.length ? '  <<< ' + flag.join(' ') : '',
  )
}

console.log('\n--- layers whose drawn box leaves the canvas ---')
let off = 0
for (const l of r.log) {
  const d = l.drawn
  if (!d) continue
  if (typeof d.x1 === 'number') {
    if (d.x1 < 0 || d.x2 > W || d.y1 < 0 || d.y2 > H) { console.log(`${l.id}: line ${d.x1},${d.y1} -> ${d.x2},${d.y2}`); off++ }
  } else if (typeof d.x === 'number' && typeof d.w === 'number') {
    if (d.x < 0 || d.y < 0 || d.x + d.w > W + 1 || d.y + d.h > H + 1) {
      console.log(`${l.id}: ${d.x},${d.y} ${d.w}x${d.h}`); off++
    }
  }
}
if (!off) console.log('(none)')

if (r.warnings?.length) { console.log('\n--- engine warnings ---'); for (const w of r.warnings) console.log(JSON.stringify(w)) }
