# Board config is exclusively owned while connected, read once per session

Refloat config values live on the board, but the app only ever reads them through the Tune screen: an on-demand `getRefloatConfigSnapshot()` that needs a trusted Board Link, is discarded on disconnect, and is re-read defensively before every write. Meanwhile a second, narrower decode (six named ids) runs after link trust purely to feed config-scoped Board Warnings, and the values are thrown away. Live UI that wants a real config number — the footpad dots, which compare ADC volts against a hardcoded 0.8 V instead of `fault_adc1` / `fault_adc2` — has nowhere to get it.

A board accepts one BLE central at a time. While a Board Session holds the link, config cannot change except through our own writes: any other tool has to disconnect us first. That makes a single read authoritative **for the session it happened in**, and makes the read-before-write ceremony on the tune path dead weight paid in seconds of rider-visible latency.

Decided: one **Board Config Values** object per Board Session, read once after link trust and refreshed only by our own config writes (which already return fresh bytes). It carries both halves of the truth, because they serve different consumers and cannot substitute for each other:

- the **raw config bytes plus package signature and parsed schema** — the only valid base for a write, since a write patches bytes rather than re-encoding a decoded map
- the **decoded field map over the whole schema** — what every reader uses, from config-safety rules to footpad thresholds to the Tune screen

Reading the whole schema is deliberate: today's decode walks only the curated tune groups, so any consumer wanting a field outside them has no path to it.

Freshness is a state, not a timestamp. A value read in the current session is **fresh**; a value restored from cache on connect is **provisional**. Provisional values may be displayed — that is the point of caching them — but may never back a write, because the escape hatch the exclusivity argument depends on is exactly the window where we were disconnected and someone else could have written. A write with only provisional values reads first, then writes.

The cache is scoped per Board and Refloat base version (as Tune Compatibility is, ADR 0022), kept while link integrity is `outdated`, and cleared everywhere — held native state, persisted row, JS store, any prefilled screen — when it goes `mismatched`, since field offsets are meaningless against different firmware.

The read serves every consumer, so it runs whenever the link becomes trusted. It is currently gated behind the Board Warnings setting; that gate belongs on warning _evaluation_, not on acquiring config.

JS reads the decoded map through a dedicated accessor and change event, not through Live State: it changes once per session and is far too wide for an event that recomposes on every phase, GPS, and scan change. The event is nullable so clearing is expressible.

A rider who writes config over CAN from a second controller mid-session can desync this. Not defended against: that rider knows the drill, and covering it would cost every other rider a re-read.
