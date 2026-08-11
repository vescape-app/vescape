# Tune screen prototype — PROTOTYPE, delete when decided

## Question

How should the tune screen organise raw Refloat values so that a new rider can change
something safely, an experienced rider keeps every field, and the "basic" layer stops
showing nonsense (`-5`, `5.3`) once the raw values drift off the basic formula?

Tune Preview is deliberately out of scope here — variants render values only.

## How to run

Dev builds only. On the existing `/tune` route:

- `/tune` — current screen (unchanged)
- `/tune?variant=A` … `?variant=E`

A yellow pill above the sync bar cycles variants (`router.setParams`). It is gated on
`__DEV__` and never renders in production.

## Variants

- **A — Depth ladder.** One `Ride / Tune / Expert` control at the top. The same six
  behaviours render at increasing detail: words only, then numbers, then raw fields
  inline under each behaviour. There is no separate advanced screen.
- **B — Drill-in behaviours.** Six rows (Balance, Nose & tail, Hills, Carving, Braking,
  Speed limits). Tap one, get a sheet with the plain control on top and _that behaviour's_
  raw fields underneath. Advanced is per-behaviour, never global.
- **C — One searchable list.** Everything is the raw list, with search and
  `All / Macros / Edited / Board diff` filters. The six basic controls are pinned macros
  in the same list — a lens over the values, not a parallel truth.
- **D — Preset + deltas.** Pick a riding style (Chill/Street/Trail/Race), then nudge with
  `-/+` steppers that show how far you drifted from the preset. Raw table collapsed at the
  bottom. Basic is a _relative_ control, so it can never invent a weird absolute number.
- **E — Feel / Values / Changes.** Three tabs. Feel = word gauges. Values = the whole raw
  table, grouped. Changes = pending edits and board diffs with revert/accept in one place
  (today that state is smeared over cells + the sync bar).

## Crazy-numbers fix, per variant

All variants stop deriving a display number from off-formula fields:

- A/B/E: off-formula reads as `Custom` (never a fake number), with a one-tap resnap.
- C: macro row shows `drifted - resnap`; raw values are the source of truth.
- D: the basic layer is a delta from a known preset, so it has nothing to invent.

## Verdict

_TBD — fill in which variant (or mix) wins and why, then delete this folder and fold the
winner into the real screen._
