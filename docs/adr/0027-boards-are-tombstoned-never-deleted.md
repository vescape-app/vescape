# Boards Are Tombstoned, Never Deleted

Deleting a **Board** sets `boards.deleted_at` instead of removing the row, on the phone and on the Vescape server alike. The Board disappears from every Rider-facing list, its configuration (Board settings, Board warnings, **Alert Rules**) is hard-deleted as before, and its **Ride History** is untouched — which is what it already was locally, and now what it is on the server too.

The reason is that **Ride History** outlives the Board that produced it. The app has always kept telemetry after `deleteBoardWithSettings`, but the server models telemetry as Board-owned through a composite foreign key with `ON DELETE CASCADE`, so a Board **Delete Action** would have wiped exactly the rides backup exists to preserve — and the phone could never have re-uploaded them, because the missing parent row makes the foreign key refuse the whole **Sync Batch**.

A tombstone keeps the parent row alive, so the foreign key holds, history survives on both sides, and orphaned **Tune Profiles** a phone re-uploads after a Board delete land instead of wedging the batch.

## Considered Options

- **Drop the foreign key on the telemetry tables**, keeping `board_id` as unenforced text. Rejected because it also drops the "a Sync Batch naming an unknown Board is refused whole" guard, which is the server's protection against a half-applied batch.
- **Cascade on the app side too** — deleting a Board deletes its Ride History locally. Rejected outright: it deletes the thing the feature exists to protect, and contradicts the rule that local storage cleanup never removes anything from the backup.
- **Hard delete plus per-child Delete Actions.** Rejected because it makes one Rider intent into an unbounded list of actions, and still leaves telemetry without a parent.

## Consequences

- `boards.deleted_at` is nullable and part of the synced row, so a tombstone reaches the server as an ordinary upsert as well as through its **Delete Action**. The two say different things and are both needed: the row says the Board is deleted, the action says its configuration is gone. Keeping the cascade an explicit, replay-safe action is what stops a dumb upsert from quietly deleting rows in three other tables — the phone writes both in one transaction, stamped with the same ratcheted timestamp (#282).
- `getBoards()` filters `deleted_at IS NULL`. `getBoard(id)` deliberately does not — **Ride History** must still be able to name a deleted Board. Callers that act on a Board rather than describe one (`buildSessionConfig`) check `deletedAt` and refuse.
- On the server the `ON DELETE CASCADE` behind the Board-owned configuration tables stops firing, because nothing is deleted anymore. The Delete Action handler deletes those children explicitly, which makes the server's cascade identical to `deleteBoardWithSettings` rather than merely similar.
- **Tune Profiles** are deliberately outside that cascade on both sides. Tuning work is expensive to recreate and survives its Board; removing one takes its own Delete Action.
- Telemetry can now carry a stable `board_id` instead of keying on the mutable BLE identifier, because the row it points at never disappears. That unblocks the identity half of the `device_name` question (#274); the label half — whether a Board name is still denormalized onto telemetry rows — is unchanged here and stays governed by ADR-0005.
- Account deletion still removes everything, cascading from the server's own user row. A tombstone is a Board-level intent, not a retention policy.
