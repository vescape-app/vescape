# Boards Are Tombstoned, Never Deleted

Deleting a **Board** sets `boards.deleted_at` instead of removing the row. The Board disappears from every Rider-facing list, its configuration (Board settings, Board warnings, **Alert Rules**, Last Known Board Config Values) is hard-deleted as before, and its **Ride History** is untouched — as it already was.

The reason is that **Ride History** outlives the Board that produced it. The app has always kept telemetry after a Board delete, but the `boards` row vanishing left those rides pointing at a Board id that resolves to nothing. History could only fall back to the `device_name` snapshotted on each row: a frozen label, not an identity. A tombstone keeps the row resolvable, so a deleted Board's rides still name it and still group by it.

## Considered Options

- **Cascade** — deleting a Board deletes its Ride History too. Rejected outright: it deletes the thing worth keeping.
- **Leave the hard delete and lean on the snapshotted `device_name`.** Rejected because a name is not an identity: renames before the delete produce rides labelled inconsistently, and nothing links a ride back to the Board it came from.
- **Move Board identity onto the history rows** (denormalize more at write time). Rejected as strictly more storage for strictly less: it still cannot answer "which rides came from this Board" after the Board is gone.

## Consequences

- `getBoards()` filters `deleted_at IS NULL`. `getBoard(id)` deliberately does not — **Ride History** must still be able to name a deleted Board. Callers that act on a Board rather than describe one (`buildSessionConfig`, `BoardConnectConfig.resolve`) check `deletedAt` and refuse.
- An ordinary upsert never clears an existing tombstone, so deletion is terminal. Only the delete path stamps one, and deleting an already-tombstoned Board is a no-op.
- **Tune Profiles** are deliberately outside the cascade. Tuning work is expensive to recreate and survives its Board; removing one takes its own deletion.
- Telemetry can carry a stable `board_id` instead of keying on the mutable BLE identifier, because the row it points at never disappears. That unblocks the identity half of the `device_name` question (#274); the label half stays governed by ADR-0005.
- Tombstones accumulate. They are one small row per deleted Board, bounded by how many Boards a rider ever owned, so no pruning rule is warranted.
- The server half of this decision — tombstones crossing the wire, and the Board **Delete Action** that carries the configuration cascade — lands with Ride History backup (#276) and is out of scope here.
