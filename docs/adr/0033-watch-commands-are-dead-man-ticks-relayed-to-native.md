# Watch commands are dead-man ticks relayed to native

ADR-0019 made the Watch Mirror strictly one-way: the phone pushes, the wrist renders. **Board Move** breaks the assumption behind that rule. Rolling a disengaged board while walking beside it is the one thing a rider does with the phone _out of their hands_ — which is exactly when the phone is in a pocket and the watch is the only reachable control. So the wrist needs to send, and the question is what it is allowed to send and how a lost message can fail safe.

The danger is specific. `BoardMoveController` streams motor output every 100 ms for as long as the hold lasts, and Refloat's own ~1 s lapse only protects against the _phone_ going quiet — it does nothing while the phone keeps dutifully repeating a hold whose release was eaten by a Bluetooth drop. A naive press/release pair over a wireless link can therefore leave a board rolling away with nobody holding anything.

## Decision

- **The wrist sends intent, never state.** ADR-0019's one-way rule now reads: state flows phone → wrist only. A command is a rider action, carries no data the phone would otherwise have to trust, and is the only thing that travels wrist → phone.
- **A hold is a repeated tick with a phone-side dead-man, not a press/release pair.** The wrist re-sends `Move(direction)` every 300 ms while a half is held; the phone stops the board after 900 ms (three missed ticks) without one. A release also sends an immediate `Move(0)`, but that message is an optimisation — the dead-man is the safety property, and it holds when the wrist is dropped, dies, or leaves range mid-hold.
- **Commands relay into the existing native action, not a parallel one.** `WatchCommandListenerService` → `CoreForegroundService.watchMove` → `WatchMoveRelay` → the same `BoardSessionController.startBoardMove`/`stopBoardMove` the phone UI calls. The wrist gets the firmware safety envelope, the link-trust gate, and the neutral-on-release behaviour for free, and there is exactly one Board Move implementation to reason about.
- **Direction on the wire, strength on the phone.** The wrist sends `-1/0/1`; the phone scales it by the rider's `boardMoveStrengthPercent`. The setting keeps one home, and a wrist that is behind the phone build can never request a stronger move than the rider configured. The strength is mirrored to the wrist through the existing settings Data Layer push for display only.
- **The listener is manifest-declared, so no phone UI is required.** A cold process may be started by the command; with no live Board Session the command is dropped, which is the correct answer to "move a board nothing is connected to".
- **The wrist offers Move only on a LIVE mirror.** A stale or missing frame means the phone has no fresh board telemetry, and a move whose effect cannot be seen is not offered.

## Consequences

- The Wear Mirror is no longer a pure display. Every future wrist command inherits this shape — a kind byte, a value byte, a phone-side relay, and an explicit answer to "what happens if this message, or the one after it, never arrives".
- The dead-man costs a message every 300 ms per hold. Holds are seconds long and rare, so this is nothing next to the frame stream already running at 4 Hz.
- `MessageClient` has no authentication beyond Wear pairing: any app on a paired watch that knows the path could send a Move. The board still only obeys while disengaged, and the phone still requires a trusted link, so the worst case is bounded by the same envelope that bounds the phone UI.

## Considered Options

- **Press/release only.** Rejected: a lost release leaves the board rolling until the rider re-establishes the link. This is the whole reason the feature needed an ADR.
- **Dead-man on the wrist (stop sending is enough, wrist detects loss).** Rejected: the wrist cannot stop the board, only the phone can. The timer has to live where the motor stream lives.
- **Send an input value (`-127..127`) from the wrist.** Rejected: duplicates the strength setting on a second device with its own update lag, and lets a stale wrist out-request the rider's current setting.
- **Route the command through JS.** Rejected for the same reason ADR-0019 put the frame push in native: JS is not running with the phone pocketed mid-ride, which is the case this feature exists for.
- **Data Layer instead of `MessageClient`.** Rejected: the Data Layer coalesces and persists, so a stale "hold" could be delivered late — the exact failure the dead-man exists to prevent.
