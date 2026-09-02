# Boards Are Tombstoned, Never Deleted

Deleting a **Board** sets `boards.deleted_at` instead of removing the row, on the phone and on the Vescape server alike. The Board disappears from every Rider-facing list, its configuration (Board settings, Board warnings, **Alert Rules**) and its decoded config caches (Last Known Board Config Values and any pending change notice) are hard-deleted as before, and its **Ride History** is untouched — as it already was locally, and now as it is on the server too.

The reason is that **Ride History** outlives the Board that produced it. The app has always kept telemetry after a Board delete, but the `boards` row vanishing left those rides pointing at a Board id that resolves to nothing. History could only fall back to the `device_name` snapshotted on each row: a frozen label, not an identity. A tombstone keeps the row resolvable, so a deleted Board's rides still name it and still group by it.

The server makes the same row load-bearing for a different reason: it models telemetry as Board-owned through a composite foreign key with `ON DELETE CASCADE`, so a Board **Delete Action** would have wiped exactly the rides backup exists to preserve — and the phone could never have re-uploaded them, because the missing parent row makes the foreign key refuse the whole **Sync Batch**. A tombstone keeps the parent alive, so the foreign key holds and orphaned **Tune Profiles** a phone re-uploads after a Board delete land instead of wedging the batch.

## Considered Options

- **Cascade** — deleting a Board deletes its Ride History too. Rejected outright: it deletes the thing worth keeping, and contradicts the rule that local storage cleanup never removes anything from the backup.
- **Leave the hard delete and lean on the snapshotted `device_name`.** Rejected because a name is not an identity: renames before the delete produce rides labelled inconsistently, and nothing links a ride back to the Board it came from.
- **Move Board identity onto the history rows** (denormalize more at write time). Rejected as strictly more storage for strictly less: it still cannot answer "which rides came from this Board" after the Board is gone.
- **Drop the foreign key on the server's telemetry tables**, keeping `board_id` as unenforced text. Rejected because it also drops the "a Sync Batch naming an unknown Board is refused whole" guard, which is the server's protection against a half-applied batch.
- **Hard delete plus per-child Delete Actions.** Rejected because it makes one Rider intent into an unbounded list of actions, and still leaves telemetry without a parent.

## Consequences

- `getBoards()` filters `deleted_at IS NULL`. `getBoard(id)` deliberately does not — **Ride History** must still be able to name a deleted Board. Callers that act on a Board rather than describe one (`buildSessionConfig`, `BoardConnectConfig.resolve`) check `deletedAt` and refuse.
- An ordinary upsert never clears an existing tombstone, so deletion is terminal. Only the delete path stamps one, and deleting an already-tombstoned Board is a no-op.
- `boards.deleted_at` is nullable and part of the synced row, so a tombstone reaches the server as an ordinary upsert as well as through its **Sync Action**. The two say different things and are both needed: the row says the Board is deleted, the action says its configuration is gone. Keeping the cascade an explicit, replay-safe action is what stops a dumb upsert from quietly deleting rows in three other tables — the phone writes both in one transaction, stamped with the same ratcheted timestamp (#282).
- On the server the `ON DELETE CASCADE` behind the Board-owned configuration tables stops firing, because nothing is deleted anymore. The Sync Action handler deletes those children explicitly, which makes the server's cascade identical to `deleteBoardWithSettings` rather than merely similar.
- **Tune Profiles** are deliberately outside that cascade on both sides. Tuning work is expensive to recreate and survives its Board; removing one takes its own deletion.
- Telemetry can carry a stable `board_id` instead of keying on the mutable BLE identifier, because the row it points at never disappears. That unblocks the identity half of the `device_name` question (#274); the label half stays governed by ADR-0005.
- Tombstones accumulate. They are one small row per deleted Board, bounded by how many Boards a rider ever owned, so no pruning rule is warranted.
- Account deletion still removes everything, cascading from the server's own user row. A tombstone is a Board-level intent, not a retention policy.
