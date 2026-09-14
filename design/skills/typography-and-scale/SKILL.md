---
name: typography-and-scale
description: Use when setting type, building a type scale, choosing typefaces, or fixing a layout whose text looks loose, cramped, or misaligned. Covers the measured type ladder, why display and body type need opposite tracking, optical versus metric alignment, line-length and leading rules, mixed CJK/Latin setting, and the real font metrics available in this engine. Load before writing any text layer into a scene.
---

# Typography and scale

## Everything here is measured, not estimated

The engine measures text with the real font: advance width, ink box, ascender,
descender and em box all come from Skia. So there is no reason to estimate a
width, and every layout decision below can be checked against a number instead
of a hunch. The previous attempt at this kind of work estimated widths by
accumulating em values per character class — CJK 1.0, capitals 0.64, and so on —
which is wrong by 20-40% against a real face and is why it could never risk
precise typography.

Useful facts about the measurement, verified:

* A CJK ideograph advances **exactly one em** in a full-width face. Five
  characters at 24px measure exactly 120px. If yours do not, the wrong font is
  being used.
* `letterSpacing` is exact: 12 characters with 8px tracking measure exactly 96px
  wider.
* `measureText` returns `actualBoundingBox*` (the ink) as well as `width` (the
  advance). **Ink and advance are different, and centring on the wrong one is
  visible.**

## Start with a ladder, not with sizes

Never choose a size per element. Choose a ratio and a base, then take sizes from
the ladder. A page reads as systematic when its sizes are steps of one ratio; it
reads as assembled when they were each picked to fit.

```
design_system what:"ladder" base:16 ratio:1.25 steps:7
```

| ratio | character |
|---|---|
| 1.125 | very tight, almost no differentiation — for dense UI, not posters |
| 1.2 | restrained, editorial |
| 1.25 | the usual default; clearly stepped without being dramatic |
| 1.333 | assertive; suits a strong single-focus layout |
| 1.5 | display-led; only a few levels survive before the jump is absurd |

**Line height comes with the size, and that is the point.** A size without its
leading is half a typographic decision. The ladder applies the standard optical
correction automatically: small text gets looser leading (1.6), body 1.5, subhead
1.3, display 1.08. Setting a headline at body leading is the single most common
way a headline looks cramped rather than bold.

**A hierarchy needs a readable step.** `design_verify` flags adjacent levels
closer than 1.25× as too close to read as deliberate, and more than one element
within 15% of the largest as a non-unique focus. Both are real defects.

## Tracking: display type tightens, small type opens

This inversion is not decoration; it is how type is optically spaced.

| size | tracking | why |
|---|---|---|
| display, 60px+ | **-0.02 to -0.04 em** | at large sizes the built-in sidebearings look like gaps |
| headline, 30-60px | -0.01 to -0.02 em | |
| body, 14-22px | 0 (the face is drawn for this) | |
| small caps, labels | **+0.06 to +0.20 em** | letters need air to stay separate when small |
| monospaced metadata | +0.10 to +0.30 em | a technical register, deliberately loose |

Tracking in the scene is **in em**, not pixels, because em is the only unit that
survives a size change. The engine converts to px at draw time.

The reference language in this preset leans hard on the last two rows: widely
tracked uppercase labels at 11-16px are a large part of how it reads as
*technical* rather than *editorial*.

## Alignment: optical, not metric

* **Centre on the ink box, not the advance width.** "M" and "T" have small
  sidebearings; "J" and "L" have large ones. Centring the advance puts a headline
  visibly off-centre.
* **Align a rule under text to the text's ink, not to its box.** A hairline under
  a word that starts at the box edge rather than the ink edge shows a small but
  definite overhang.
* **Right-align numbers on their decimal or their last digit**, not their box.
* **Hang punctuation.** A line beginning with an opening quote or bracket should
  hang into the margin rather than indenting the text.

## Line length and leading

* **Measure, in characters:** 45-75 characters per line for comfortable reading;
  60-70 is the sweet spot. Below 40 the rhythm breaks; above 90 the eye loses the
  line start.
* For CJK the equivalent is **25-40 characters per line**, because each glyph is
  a full em.
* **Leading rises as the measure lengthens.** A 40-character measure is
  comfortable at 1.4; an 80-character measure needs 1.5-1.6 or the eye skips
  lines on the return sweep.
* **Never leave a single word alone on the last line.** The engine's wrapper
  handles this by preferring a slightly looser earlier break, but a headline you
  set by hand with `wrap: false` will not.

## Mixed CJK and Latin — the part that is usually done wrong

Mixing scripts is the normal case here, and it needs decisions that a single
font cannot make.

**Use a font stack, not one family.** A Latin-only face renders CJK as tofu. The
engine splits a string into script runs and gives each run the first family in the
stack that covers it:

```json
"font": { "family": ["Grotesk", "SansSC"], "size": 30 }
```

The report tells you which families were actually used and whether a fallback
occurred (`fontFallback: true`). **Treat a silent fallback as a defect** — it
means the face you asked for could not render the text.

**Space between scripts.** A CJK glyph and a Latin word set flush against each
other look crowded, because the CJK em includes generous sidebearings and the
Latin does not. Add a thin space (0.15-0.25 em) at each script boundary, or set
the Latin slightly smaller.

**Do not set a long Latin line in a CJK face**, or the reverse. The proportions
disagree and the result reads as an accident.

**Vertical setting rotates Latin.** In `vertical: true` text the engine rotates
Latin and punctuation upright within the column, which is what East Asian
vertical typesetting actually does. CJK stays upright.

## The faces available here, and their real axes

`design_system what:"fonts"` lists what can be set. What matters:

* **SansSC** (Noto Sans SC, variable) — `wght` **100-900, and it really works**.
  This is the workhorse for Chinese display and body.
* **SerifSC** (Noto Serif SC, variable) — `wght` 200-900. For an editorial or
  literary register.
* **Grotesk** (Bahnschrift, variable) — `wdth` **75-100 works**; its `wght` axis
  **does not** in this engine, so weight variety for Latin comes from the static
  families instead. A narrow setting at 78 is genuinely useful for a technical
  Latin label.
* Static weights: Neue/NeueLight/NeueSemilight/NeueBold/NeueBlack (Segoe UI),
  Journal/JournalBold/JournalItalic (Georgia), Antiqua (Times), Calibri,
  Mono/MonoTech/Code for the technical register.

**The trap that silently ruins a design:** for a variable font, the weight token
in a font shorthand **does nothing**. `'900 48px SansSC'` and `'400 48px SansSC'`
measure identically — verified. Weight must go through the variation axis. This
engine's `styleFor()` returns the shorthand and the axis settings together
precisely so that half of it cannot be applied alone. Noto Sans SC's default
weight is **100**, so getting this wrong does not produce "normal" text; it
produces hairlines, which look like a deliberate style choice and are easy to
ship by accident.

## A workflow for setting a page's type

1. Decide the information levels first — how many, and their order. Not the
   sizes: the *levels*. Usually two to four.
2. `design_system what:"ladder"` to get the sizes with their leading.
3. Assign each level a step, leaving at least one unused step between levels that
   must read as clearly different.
4. Choose the faces and the stack, per script.
5. Set tracking by size from the table above.
6. Write the text layers, with `fit: true` on any display line whose width must
   fill a measure exactly.
7. Render, then read the report: `overflow`, `fitted.size`, `families`,
   `fontFallback`. Any `overflow: true` or `fontFallback: true` is a defect —
   fix it before looking at anything else.
8. Look at the render. Then check `design_verify`'s type-step and focus findings.
