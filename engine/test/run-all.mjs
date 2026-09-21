/**
 * Run every test suite and report one line each.
 *
 * WHY A RUNNER EXISTS
 * -------------------
 * The suites were run one at a time by hand, and that is how a stale guard in
 * a suite sat red without anyone noticing: every tool passed, the exit code
 * was non-zero, and no one was reading the exit code of a command they had typed individually.
 * A single runner with a single exit status makes "all green" checkable in one go.
 *
 * Usage:
 *   node test/run-all.mjs
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

// Suites that assert something about the engine. Order is cheapest-first so a broken
// cheap suite fails the run before the slow ones spend time.
const SUITES = [
  'scale.mjs',
  'analyze-flatness.mjs',
  'check-render.mjs',
  'workspace-layout.mjs',
  // Cheap, and it is the gate that says whether the harness is loading the preset this
  // repository describes — so it runs before anything that spends time on pixels.
  'deploy-drift.mjs',
  'render-regressions.mjs',
  'input-spellings.mjs',
  'scope-regions.mjs',
  'scope-conflicts.mjs',
  'filters.mjs',
  'effects.mjs',
  'palette.mjs',
  'palette-ops.mjs',
  'presets.mjs',
  'selftest.mjs',
  'psd-roundtrip.mjs',
  'tool-schemas.mjs',
  'tool-registry-gate.mjs',
]

// Refuse to run a suite that exists on disk but is missing from the list above, so a
// new test file cannot be silently left out of the gate. A file whose name starts with
// `_` is a HELPER (a shared locator, a fixture), not a suite — the prefix is how you
// mark it as one, and it is why `_preset-locate.mjs` is not an error here.
const present = readdirSync(here).filter((f) => f.endsWith('.mjs') && f !== 'run-all.mjs' && !f.startsWith('_'))
const missing = present.filter((f) => !SUITES.includes(f))
if (missing.length > 0) {
  console.error(`run-all: these suites exist but are not in the list: ${missing.join(', ')}`)
  process.exit(1)
}

let failed = 0
const results = []

for (const suite of SUITES) {
  const started = Date.now()
  const proc = spawnSync(process.execPath, [join(here, suite)], {
    cwd: join(here, '..'),
    encoding: 'utf8',
  })
  const ms = Date.now() - started
  const out = `${proc.stdout ?? ''}${proc.stderr ?? ''}`
  const summary = out.split('\n').filter((l) => /checks passed|tools are usable|tools project/.test(l)).pop() ?? ''
  const ok = proc.status === 0
  if (!ok) failed++
  results.push({ suite, ok, ms, summary: summary.trim() })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${suite.padEnd(24)} ${String(ms).padStart(6)}ms  ${summary.trim()}`)
}

console.log(`\n=== ${SUITES.length - failed}/${SUITES.length} suites passed ===`)
if (failed > 0) {
  console.log('failed: ' + results.filter((r) => !r.ok).map((r) => r.suite).join(', '))
}
process.exit(failed === 0 ? 0 : 1)
