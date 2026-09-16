/**
 * Check the knowledge library against the repository copies, and report drift.
 *
 * WHY THIS EXISTS
 * ---------------
 * A few documents legitimately exist in two places. `knowledge/` is the working library the
 * agent reads and writes; the repository keeps four of the same documents so that a FRESH CLONE
 * can bootstrap — without them a new checkout has no rules to read at all.
 *
 * Two copies of one document diverge in silence. The failure is not that a file goes missing;
 * it is that you edit one copy, the agent reads the other, and the version you are looking at
 * is not the version that was used. This script makes that visible instead of trusting it not
 * to happen.
 *
 * It reports; it does not reconcile. Which copy wins is a judgement — the library is where
 * retrospectives are written, the repository is what other people clone — so the fix is a
 * deliberate `cp`, not an automatic sync that could overwrite someone's work.
 *
 * Usage: node verify-knowledge.mjs
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const REPO = dirname(fileURLToPath(import.meta.url))
const WS = join(REPO, '..')
const LIB = join(WS, 'knowledge')

/** Pairs that are expected to hold the same content. */
const PAIRS = [
  ['tooling/设计方法原理-给agent.md', 'docs/设计方法原理-给agent.md'],
  ['tooling/设计问题与技术问题-给agent.md', 'docs/设计问题与技术问题-给agent.md'],
  // The 终末地 breakdown is a PROJECT document — its home is the deck it was written for — so
  // the repository copy was removed and this pair now guards the project copy instead. The
  // library keeps a general copy under reference/, because the vocabulary it establishes is
  // reusable beyond that one deck; the project keeps the one that belongs to it.
  ['reference/终末地-设计语言拆解.md', '../projects/2026-09-16-endfield-language-deck/终末地设计语言拆解.md'],
  // 视频测量 and the retrospectives exist ONLY in the library. They are process material, so a
  // clone does not get them; the repository keeps the two methodology documents, which the
  // depth-and-structure skill cites and which let a fresh checkout read the rules at all.
]

/**
 * Documents that must NOT be duplicated into the library, with the reason. Listed so that a
 * future reader can see the boundary was a decision rather than an oversight.
 */
const MUST_STAY_OUT = [
  ['projects/*/', '每个项目自己的艺术拆解 — 具有特殊性，只对那一个版面成立'],
  ['design/skills/*/SKILL.md', 'customSkillDirs 加载它们，移动会静默丢失技能'],
  ['refs/', '素材本体（截图/录像/官网源文件），不是文档'],
]

const hash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 12)
const kb = (p) => (statSync(p).size / 1024).toFixed(1) + ' KB'

console.log(`workspace ${WS}`)
console.log(`library   ${LIB}\n`)

if (!existsSync(LIB)) {
  console.error('the library does not exist. Nothing to verify.')
  process.exit(1)
}

console.log('=== library vs repository ===')
let drift = 0
let missing = 0
for (const [libRel, repoRel] of PAIRS) {
  const a = join(LIB, libRel)
  const b = join(REPO, repoRel)
  const da = existsSync(a)
  const db = existsSync(b)
  if (!da && !db) { console.log(`  ??  ${libRel}  — absent from both`); missing++; continue }
  if (!da) { console.log(`  --  ${libRel}  — missing from the LIBRARY (repo has ${kb(b)})`); missing++; continue }
  if (!db) { console.log(`  ++  ${repoRel}  — missing from the REPO (library has ${kb(a)})`); missing++; continue }
  const ha = hash(a)
  const hb = hash(b)
  if (ha === hb) {
    console.log(`  ok  ${libRel.padEnd(40)} ${kb(a).padStart(10)}  ${ha}`)
  } else {
    drift++
    console.log(`  !!  ${libRel}`)
    console.log(`        library ${kb(a).padStart(10)}  ${ha}`)
    console.log(`        repo    ${kb(b).padStart(10)}  ${hb}   (${repoRel})`)
    const ta = statSync(a).mtime.toISOString().slice(0, 16).replace('T', ' ')
    const tb = statSync(b).mtime.toISOString().slice(0, 16).replace('T', ' ')
    const newer = statSync(a).mtimeMs >= statSync(b).mtimeMs ? 'library' : 'repo'
    console.log(`        newer: ${newer}   library ${ta}   repo ${tb}`)
  }
}

console.log('\n=== must NOT be duplicated into the library ===')
for (const [p, why] of MUST_STAY_OUT) console.log(`  · ${p.padEnd(30)} ${why}`)

// Anything in the library that is NOT one of the paired documents is library-only, which is
// the normal case for retrospectives. Report it so the shape is visible, not to warn.
console.log('\n=== library contents ===')
for (const sub of ['reference', 'tooling', 'agent']) {
  const d = join(LIB, sub)
  if (!existsSync(d)) { console.log(`  ${sub}/  (absent)`); continue }
  const items = (await import('node:fs')).readdirSync(d)
  console.log(`  ${sub}/  (${items.length})`)
  for (const i of items) {
    const paired = PAIRS.some(([l]) => l === `${sub}/${i}`)
    console.log(`      ${i.padEnd(44)} ${paired ? 'paired with the repo' : 'library only'}`)
  }
}

console.log(`\n${drift === 0 && missing === 0 ? 'no drift' : `${drift} drifted, ${missing} missing`}`)
process.exit(drift === 0 && missing === 0 ? 0 : 1)
