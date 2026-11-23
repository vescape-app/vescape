# Board config edits are changesets, and history is board revisions

On Refloat 1.3, a rider changed only ATR settings and lost unrelated values they had set in VESC Tool. Save & sync wrote the whole stored Tune Profile field map, so stale profile values overwrote newer board values, and Tune History recorded profile saves rather than what the board actually held. Every board config edit (tune tweak, Tune Profile apply, general setting, revert, import) is therefore one Config Changeset: only the changed fields, applied natively on top of the fresh in-session Board Config Values (ADR 0035), validated whole, and verified by read-back. History is an append-only list of Board Config Revisions, one per distinct verified board state, including external changes found at session start. It replaces Tune History, and revert computes a new changeset instead of replaying a stored profile.

The field set comes from the board's own Board Config Schema (its XML), with a Field Overlay for labels, usual ranges and hard limits, instead of hard-coded per-platform field lists that pinned the app to one Refloat version.

## Considered Options

- **Re-read the config before every write** (compare-and-swap): rejected. A Board accepts one connection at a time and reads are slow; keeping the in-memory write base correct after every app command is enough (ADR 0035).
- **Keep writing whole Tune Profiles, but refresh them from the board first:** rejected. A profile still cannot tell a deliberate value from a stale one, and it gives settings outside the tune no history.
- **Reset to defaults:** not offered. Refloat setup is board-specific, so starting over stays a VESC Tool action.

## Consequences

- Tune edits write immediately without a review step; general settings, reverts and imports show the changeset for review first.
- Revisions are stored with their raw bytes and schema hash, so a revert across a Refloat update matches fields by id and lists those it cannot restore.
