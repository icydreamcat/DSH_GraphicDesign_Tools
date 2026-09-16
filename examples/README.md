# examples — what this engine actually draws

Three renders, promoted out of the gitignored `engine/out/`. Everything in `engine/out/`
is a build artifact, rewritten on every iteration; these three are here
because a rendering engine with no picture in its repository has to be taken on faith.

| file | what it shows |
|---|---|
| `poster-e-tooled.png` | A finished poster at full delivery size, **2400×1350**. Ground, accent band, cut-out subject, a 214px title, a rule system, and an `emboss` + `pattern` treatment on the type. |
| `poster-variants-and-scope.png` | The same layout in **six treatments** (flat / soft / press / light / tooled / scoped), annotated. This is the clearest single statement of what the seventeen layer effects do, and of why the sixth one exists: comparing C and F shows the same duotone-and-screen idea, with `scope` keeping the treatment off the face. |
| `effect-sheet.png` | The effect vocabulary side by side. Small enough to keep. |

## Reproducibility, stated honestly

**These images are artifacts, not a build target.** They were rendered on the machine this
project was written on, from scenes that reference source material by ABSOLUTE path — and
that source material (`engine/assets/`, `engine/refs/`) is deliberately **not** in this
repository. Character art and reference posters are inputs for that machine's work, not
part of the toolchain. A fresh clone is meant to make its own work, so what it gets is the
engine, the tools and the preset.

The consequence, without hedging:

| On a fresh clone | Works? |
|---|---|
| the engine, the 25 session tools, the 8 preset tools | ✅ |
| all 13 test suites (`node test/run-all.mjs`) | ✅ fully — they were made self-contained on purpose |
| rendering `engine/scenes/*.json` | ❌ their absolute `src` paths and their files are absent |
| regenerating the images below | ❌ same reason |

That is the line that was drawn. The suites were rewritten to hold it: none of them loads
anything from `engine/assets/` any more, and none hard-codes a per-machine path, so a clone
can verify the toolchain before using it — which is the point of shipping it.

To render something of your own, write a scene that uses your own images (a **relative**
path resolves against the scene file's directory, which is the portable form) or that uses
no images at all: `rect` / `ellipse` / `polygon` / `path` / `text` need nothing external.

## A caveat worth keeping

The render report for these is `0 error / 0 warning` for the *engine* — no layer failed, no
text overflowed, no font fell back silently. That is not a claim that the design is good.
`verification` still reports design-level notes (for `poster-a-flat` it flags
`density.everythingHeavy`), and the engine's own documentation is explicit that a clean
report is not a finished design. Judge the images.
