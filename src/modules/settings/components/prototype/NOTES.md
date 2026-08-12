# PROTOTYPE — auto-start UI

Question: what shape should the Android "Auto start app" section be?

Rejected: rounds 1–4 (A–Q), round 5 (R/S — right structure, but "Add board" opened a full-screen
modal, which reads nothing like the small inline "+" that triggered it).

Settled model: **one card, sized to how many boards you have.**

- 0 linked boards — switch disabled, hint "Link a board first".
- 1 linked board — plain switch, no list. Toggling on arms that board silently.
- 2+ boards — switch plus in-place board picking, with an amber "nothing will start the app"
  state while nothing is added.

Round 6 (`?variant=T|U`) drops the modal entirely:

- T — "+ Add board" expands the unarmed boards inline right under it (LayoutAnimation, the "+"
  rotates to an "×"/Cancel). Nothing leaves the card.
- U — no add affordance at all: every linked board is a chip, dashed outline when off, green when
  armed. Tap toggles. Fewest states, but no explicit "add" gesture.

`useAutoStartCard` holds the sizing/hint logic — that logic is the real output of this prototype;
the components are skins.

Cooldown ("don't restart for N min") still has no home — decide before folding in.

## Verdict

TBD — fill in the winner and why, then delete this folder and fold the winner into
`src/app/settings/connection.tsx` (also drop the now-unused board picker modal + bg-location prompt
wiring that the winner doesn't need).
