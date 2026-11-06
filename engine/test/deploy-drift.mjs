/**
 * Deploy drift: the installed preset must be the repository's preset.
 *
 * THE FAILURE THIS SUITE EXISTS FOR
 * ---------------------------------
 * `design/` is the preset source under version control; `deploy-preset.mjs` copies it to
 * `$DSH_HOME/.agent-presets/design`, and the harness loads ONLY the installed copy —
 * DSH discovers presets by scanning that directory and skipping every child that is not
 * a real directory, so a junction or a symlink does not work and there is no way to
 * point the harness at the repository instead (all three were tried; see the header of
 * deploy-preset.mjs).
 *
 * In one session a long series of edits went into `design/agent.cordis.yml` and was
 * validated every way available — YAML parsed, line counts, a checker script. Deploy was
 * never run. Every validation was performed on the source file while the live artefact
 * stayed old, and nobody noticed for weeks. The point of the validation was defeated by
 * the one step nobody enforced.
 *
 * SO THIS SUITE ASSERTS THE EXIT CODE OF `deploy-preset.mjs --check`, AND THE THREE
 * STATES IT HAS TO GET RIGHT ARE:
 *
 *   in sync        source and install byte-identical            PASS
 *   drift          any file differs, is missing or is extra     FAIL  — this is the point
 *   not installed  no install exists to compare against         SKIP, exit 0
 *
 * The third state is not a nicety. A fresh clone has never been deployed, and a suite
 * that failed there would be red on every machine that has not installed the preset —
 * which is how a gate gets switched off. It is reported loudly as "skipped" so the
 * difference between "compared and clean" and "nothing to compare" is never glossed over.
 *
 * The check is invoked as a CHILD PROCESS rather than imported, because the exit code IS
 * the artefact under test. Importing the module would test a function and not the gate.
 *
 * Run: node test/deploy-drift.mjs
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { installedPresetDir, presetDir } from './_preset-locate.mjs'

let failed = 0
let checks = 0
let skipped = 0
function check(label, ok, detail) {
  checks++
  if (ok) console.log(`  ok    ${label}${detail === undefined ? '' : '  — ' + detail}`)
  else { failed++; console.log(`  FAIL  ${label}${detail === undefined ? '' : '  — ' + detail}`) }
}

// This file lives at <repo>/engine/test/, so the repository root is two levels up.
const repo = resolve(import.meta.dirname, '..', '..')
const source = presetDir()
const installed = installedPresetDir()

console.log('=== deploy drift: the installed preset must match design/ ===')
console.log(`  source    ${source}`)

if (installed === undefined) {
  // Nothing to compare. Stated as a fact and not as a quiet pass: a skipped gate is
  // worth knowing about, and this is the state of every fresh clone.
  skipped++
  console.log('  installed (none)')
  console.log('\n  SKIP  no preset is installed, so there is nothing to compare against.')
  console.log('        A fresh clone is expected to be in this state: deploy first with')
  console.log('          node deploy-preset.mjs')
} else {
  console.log(`  installed ${installed}`)
  console.log(`  running   node deploy-preset.mjs --check\n`)

  const proc = spawnSync(process.execPath, [resolve(repo, 'deploy-preset.mjs'), '--check'], {
    cwd: repo,
    encoding: 'utf8',
  })
  const output = `${proc.stdout ?? ''}${proc.stderr ?? ''}`
  for (const line of output.trimEnd().split('\n')) console.log(`  | ${line}`)
  console.log('')

  // The verdict is printed as the last line and restates its own exit code, so a drift
  // report says out loud what the code meant rather than leaving it to be inferred.
  const verdict = output.trimEnd().split('\n').pop() ?? ''
  check('--check prints a verdict line', /^verdict: /.test(verdict), verdict.slice(0, 100))

  if (proc.status === 0) {
    check('source and install are identical', /^verdict: in sync/.test(verdict), verdict)
  } else if (proc.status === 2) {
    // The directory exists but the install is not usable, so this is "not installed"
    // after all — the deploy cannot see a preset to compare against.
    check('the not-installed state is reported as such', /^verdict: not installed/.test(verdict), verdict)
    skipped++
    console.log('  SKIP  the install is not present; nothing to compare.')
  } else {
    check('source and install are identical', false,
      'DRIFT — the harness is loading the installed copy, not this repository. Run: node deploy-preset.mjs')
    check('the verdict names drift', /^verdict: DRIFT/.test(verdict), verdict)
  }

  // Exit codes 0/1/2 are the contract documented at the top of deploy-preset.mjs. Any
  // other code means the gate itself broke, which must not be mistaken for a clean
  // comparison — so it is failed here rather than tolerated.
  check('the exit code is one the gate documents', [0, 1, 2].includes(proc.status),
    `exit ${proc.status}`)
}

console.log(`\n=== ${checks - failed}/${checks} checks passed${skipped > 0 ? `, ${skipped} skipped` : ''} ===`)
process.exit(failed === 0 ? 0 : 1)
