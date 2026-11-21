# The Board notification follows session ownership, not link health

- **Mirrors the Board phase:** every phase renders its own text; no phase borrows another's copy (a reconnecting session says "Reconnecting…", never "Board not connected").
- **Outlives the Board Session:** after a disconnect it stays up as idle + Connect; it is cancelled only on Exit or auto close.
- **Actions derive from session ownership:** a session that exists without a live link (Stale, Reconnecting, Rescanning, Error) still offers Disconnect. Losing the link must never strand the rider with a notification they cannot act on. Only phases with nothing to cancel drop the action.
- **Telemetry only in Connected:** values (text, battery progress, chip) show only while Connected, so a dead link never displays stale numbers.
- **Whole-phase table test:** `NotificationPresenterTest` covers every `BoardPhase`, so a new phase fails until its rendering is decided.
