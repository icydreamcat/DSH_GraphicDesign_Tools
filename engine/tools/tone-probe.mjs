/**
 * tone-probe — print only the tone/effect records from a render report.
 *
 * The report's log is thousands of entries long, and the ones that carry the
 * numbers I need (halftone dot count, coverage, tone source; grain mean shift;
 * adjustment strength) are buried in it. PowerShell also mangles the CJK in the
 * file, so this reads it with Node.
 */
import { readFileSync } from 'node:fs'

const j = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const r = j.report ?? j
const want = new Set(['shapetone', 'effect', 'adjustment', 'tone', 'mask'])
for (const e of r.log) {
  if (!want.has(e.step)) continue
  console.log(JSON.stringify(e))
}
