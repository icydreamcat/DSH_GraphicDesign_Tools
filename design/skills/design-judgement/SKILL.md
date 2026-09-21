---
name: design-judgement
description: Use when a composition is not working and you cannot say why, when you are about to verify a style with numbers, when you catch yourself patching one defect and creating another, or when a reviewer said the work is wrong without saying what is right. Covers how style is actually identified (look, do not compute), the correct reading of "high frequency, low contrast" — which is MORE marks and fainter, never fewer — why a 17-round local-patch loop is unsalvageable and what to do instead, why piling up elements and then proving the count is a failure with a receipt, why a metric can be satisfied while the page is still wrong, and how to state a limit honestly instead of asserting past it. Load this when the work feels wrong, and before defending any number as proof that it is right.
---

# Design judgement

## What this skill is for

Every other skill here tells you how to make something. This one is about the gap
between a page that **passes every check** and a page that **works** — the gap
that a real session spent seventeen rounds inside without closing.

The material is not theory. It is a list of the ways this particular failure
recurs, each with the sentence that identified it.

## Style is looked at, not computed

The clearest correction in the whole record, from the person who owns the work:

> "Don't just quantify and compare pixels. You have to be able to recognise a
> style. The point of design is that the style matches — not that the pixel
> proportions match."

And from the course material:

> "Everyone gets too tangled up in the question of style." · "You don't need to
> make it that complicated." · "Don't try to summarise what style it is." ·
> "First find references. What elements does this style use most? Then make small
> differentiations."

**The method, in order:** do not define the style first → find references → pull
out the elements that style uses most → introduce small differentiations on your
own page. Defining the style up front and then building to the definition is
working backwards, and it is why a page can be measurably close to its reference
and still obviously not of the same family.

The proof is in the record. Nine reference images were read **by eye alone**,
with no metric computed, and produced this specification:

| Dimension | What all nine agreed on |
|---|---|
| Light | **Bright backlight plus dappled spots** (5 of 9 have spots on the face); rim light on hair tips and tail edges |
| Primary hue | **Blue-green is mandatory** (headband and skirt): teal → cyan-blue |
| Second | **Large areas of cream-gold** (hair and clothing) |
| Third | Cherry pink — small in area, critical in position |
| Accent | **Pure black** (the mascot); highlights are two white points, nothing more |
| Tail | **Not part of the body — a radial mass arranged into a halo** |
| Technique | Watercolour soft light; **not collage** |

Not one number was computed for that table, and it was more useful than ten
rounds of metrics. That is the claim this section is making, and it is an
observation from a real comparison, not an opinion.

## "High frequency, low contrast" means MORE marks, fainter

This is the most misread instruction in the whole discipline, and misreading it
produces a specific, recognisable kind of bad page.

The original: *richness comes from many marks each barely visible, not from few
marks each heavy.*

It was read as **"few"**. It says **"many and faint"**. The skills carry the
number: **40+ independent regions, up to 300 for fine work.**

The recorded failure: after deleting a colour band, the work stopped there and
was delivered at **12 elements** — and the rule above was quoted in defence of
that emptiness. The correct action was to remove the interference *and add more,
fainter things at the same time.*

The course states the same thing more bluntly:

> "That means you definitely have to delete things." · "You can't make it a
> thousand-layer cake like my composite."

**Deleting and adding are simultaneous.** "Replacing material means deleting the
old material in the same change" was only ever done halfway — the deleting half.

## A 17-round patch loop is not a slow path to a good page

The single most expensive pattern in the record:

> "Seventeen versions of local patching, not one redesign from scratch." — judged:
> "The whole image gets uglier the more you change it. No logic, no content, and
> the style was wrong from the start."

The diagnosis matters more than the verdict. Each round fixed the specific thing
that was named, and **the thing that was wrong was never in the elements being
fixed.** Two consequences:

- **If the foundation is wrong, no number of local fixes reaches it.** The
  recommendation attached to that project was explicit: do not continue from that
  version; start again from the four questions.
- **Changing only what was pointed at is itself a failure** — see below.

## Self-check is the job, not a courtesy

> "Each time I raise several problems — that's only an example, because there are
> many things wrong. I want you to check yourself, and instead you only fix the
> part I mentioned."

So: when a reviewer names one defect, treat it as evidence of a **class**. Search
the whole piece for the rest of the class before replying. Fixing only the named
instance is how a piece accumulates the same defect in nine places.

And the twin of that failure:

> "The things the course taught, you don't recall unless I mention them — and now
> that you do, you've forgotten the problems I raised earlier."

Patching the newest complaint while dropping the previous one moves the defect
around instead of removing it. Keep a list, and check the earlier items again.

## A metric can be satisfied while the page is still wrong

Two receipts, both from the same session:

**The count.** Elements were piled from 12 to **611**, and `design_critique` was
about to be used to prove the quantity was now sufficient. The verdict:

> "You piled up a heap of base shapes with no texture, no theme and no relation
> between them — and then told me with data that the quantity was up to standard."

**The inventing.** Specifications and data tables were written for a subject that
had no data:

> "You made up a pile of figures and structure to pad it out. That's not what we
> were doing at all."

**The rule:** a number can be true and irrelevant. Before citing one as proof,
say what it is a proxy for, and what a page satisfying it could still get wrong.
If the answer is "the thing the reviewer is complaining about", the number is not
evidence.

## Repetition is not a system

Using the same asset at several sizes, or placing it several times by hand, is
**one shape repeated** — a texture with no direction. It reads as sloppy however
evenly it is distributed.

A system is **one base unit and many derivatives of it**: same construction,
varied along the three axes the eye actually reads — **which form, how many, how
heavy** — plus density by position. Say the rule that generates the set, and let
the count follow from the rule rather than from a target number.

## Where the honest limit is

Three things were never solved in the session this file comes from, and naming
them is more useful than pretending otherwise:

1. **Material process was not unified.** The figure was soft watercolour; the
   paper items, labels and tape were hard-edged vectors. Either fix damages
   something real, and the approximation reached was only that.
2. **Too few material families.** Three (paper, emblems, washi tape) against a
   reference that showed six. Missing: leather, metal, cloth, glass.
3. **A supplied figure's anatomy cannot be changed.** If the work arrives as a
   finished image, its silhouette is what it is; a bottom edge can be solved by
   alpha, not by finding a natural contour that is not there.

And the boundary that no tool here crosses: whether the metaphor is apt, whether
the character suits its audience, whether the composition genuinely pleases.
Those are the owner's calls. Say where the measurement stops and hand it over —
that is part of the deliverable, not an admission of failure.
