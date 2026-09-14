# examples — what this engine actually draws

Three renders, promoted out of the gitignored `engine/out/`. Everything in `engine/out/`
is a build artifact (42 files, ~46 MB, rewritten on every iteration); these three are here
because a rendering engine with no picture in its repository has to be taken on faith.

| file | what it shows |
|---|---|
| `poster-e-tooled.png` | A finished poster at full delivery size, **2400×1350**. Ground, accent band, cut-out subject, a 214px title, a rule system, and an `emboss` + `pattern` treatment on the type. |
| `poster-variants-and-scope.png` | The same layout in **six treatments** (flat / soft / press / light / tooled / scoped), annotated. This is the clearest single statement of what the seventeen layer effects do, and of why the sixth one exists: comparing C and F shows the same duotone-and-screen idea, with `scope` keeping the treatment off the face. |
| `effect-sheet.png` | The effect vocabulary side by side. 128 KB, so it is cheap to keep. |

## Reproducibility, stated honestly

`poster-e-tooled.png` and `effect-sheet.png` are each one `design render` away from a scene
that is committed beside them. Nothing was touched up in an editor: the engine writes the
PNG and its measurement report in the same pass.

```powershell
cd engine

# the full-size poster
node bin/design.mjs render scenes/poster-e-tooled.json --out out --name poster-e-tooled

# the effect sheet
node bin/design.mjs render scenes/effect-sheet.json --out out --name effect-sheet

# copy the curated set into this directory
cd ..
node make-examples.mjs
```

`node make-examples.mjs --check` reports what it would copy without writing.

**The comparison sheet is the exception.** All six source scenes are committed
(`scenes/poster-{a-flat,b-soft,c-press,d-light,e-tooled}.json` and `scenes/press-scoped.json`)
and each renders in about a second, but the script that composed the six into one annotated
sheet was written inline in the session that produced it and was never kept. Committing the
image is therefore the only record of the comparison; the six panels are reproducible, the
arrangement is not. Writing that script properly is an open item.

## A caveat worth keeping

The render report for these is `0 error / 0 warning` for the *engine* — no layer failed, no
text overflowed, no font fell back silently. That is not a claim that the design is good.
`verification` still reports design-level notes (for `poster-a-flat` it flags
`density.everythingHeavy`), and the engine's own documentation is explicit that a clean
report is not a finished design. Judge the images.

