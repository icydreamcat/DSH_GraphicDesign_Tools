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

## Design is built at the start, not tuned after

The single most expensive habit in this discipline, named directly by the person who owns the work:

> "Your last suggestion is essentially still just fiddling with parameters. Design should be built up at
> the start and then carried out a little at a time."

**"凑参数" — parameter-fiddling — is not a slower route to the same place.** It is a different activity
that produces a different object. A page tuned into shape keeps the structure it started with and gets
its numbers moved around; a page designed at the start has a structure that the numbers express. From
the outside, after enough rounds, the two look similar in a thumbnail and completely different in
person — and only one of them survives being changed.

The same complaint, in its most extreme form: *"the whole image gets uglier the more you change it."*
That is the signature of tuning: every local fix is locally correct and the whole drifts.

**Rule:** when you notice you are adjusting values to make something read better, stop and ask which
of the declared decisions is wrong. If nothing in `gates` is wrong, you have not found the problem
yet — you have found its symptom.

## Measure to falsify, never to confirm

This resolves the apparent contradiction between "measure, do not estimate" and "don't only quantify
and compare pixels". Both are instructions, and they are not in conflict because measurement has one
direction:

> "You can't just measure. You have to actually understand the design logic and why a single operation
> is done, and when it should be done. That is the general method."

**A measurement can tell you a page is wrong. It can never tell you a page is right.** Ratios, shares
and colour counts are falsifiers. When one is inside its band, that establishes the absence of one
particular defect and nothing at all about whether the page works. The moment a number is offered as
evidence that something IS right, it has been misused — and that is the misuse the owner kept catching:

> "You're still fitting basic text and basic shapes to pixel proportions."

Two rules that follow, and both are checkable by you before anyone else sees the work:

1. **Before measuring anything, establish what is actually ON the page.** *"You can quantify an image,
   but often you have not established what is actually in it, and you blindly measure the share of
   different elements — the result is numerically identical and the picture has no logic and is nothing
   like the reference."* Counting first, measuring second. A proportion measured over the wrong
   contents is a confident answer to a question nobody asked.
2. **Do not add something whose only effect is on a number.** Gradients and opacity were added to raise
   complexity, and the verdict was: *"this is not composite design at all, it is still measuring pixels
   so the data looks better."* If the reason for an element is a metric, the element is not a design
   decision.

## Recognise a style; do not summarise it into a rule

The course material is explicit about this and it is easy to reverse: *"don't try to summarise what
style it is"*, *"you don't need to make it that complicated"*, *"first find references — what elements
does this style use most? — then make small differentiations"*.

Two failure modes sit on either side of the correct path, and both were hit:

- **Defining the style first**, then building to the definition. The page is measurable against a
  definition it invented and fails the only test that matters: does it belong to the same family as
  the reference.
- **Copying the reference's content** rather than borrowing its complexity. *"You are using flat,
  straightforward information or screenshots to fill the frame... the reference uses shapes, or
  material you designed and processed yourself."* And: *"the reference and the thing I asked you to
  make are actually not the same style. You should compare their complexity and their technique, then
  think separately about what YOUR image needs — not copy it over."*

So: borrow the **complexity and the technique**; do not copy the **information and the content**. And
**not every part of a piece goes through the same process** — *"you should sort out the logic first,
then do them one at a time"*. One pipeline applied to every element is how a page becomes a template.

## When your own notes do not save you

Named as the root cause, by the owner, at the end of the session:

> "This agent has already summarised a lot and written it into rules and skills — and you still forget
> it. **That is the root problem.**"

**Writing something down is not the same as having it.** A rule that is present in context and not
acted on is indistinguishable from a rule that was never written, and a skill that is loaded and
misread is worse, because it supplies vocabulary for repeating the mistake confidently.

This is why the working policy is short and every line in it is attached to a check that fails: the
test of a rule is not whether it can be quoted, but whether ignoring it stops the work. When you find
yourself able to recite a principle and unable to apply it, you have found the thing this file exists
for — and the fix is not to write it down again.

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
