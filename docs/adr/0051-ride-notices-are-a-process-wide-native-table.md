# Ride Notices are a process-wide native table

- **Process-level owner, not the Board Session:** `RideNotices` owns the table for the whole process, so a notice outlives the foreground service and every surface (JS card, Watch Mirror, ride notification) reads one owner. Mutations run on the main thread; expiry is scheduled for the earliest `expiresAt`. Listeners fire only when the visible list changes.
- **Pure engine:** `RideNoticeEngine` has no clock, threads, or platform types, so every rule is unit tested.
- **Revision rules:** a post with the same `revision` updates content in place and keeps a dismissed notice hidden; a new `revision` bumps `rev` and shows it again.
- **Dismiss names `(id, rev)`:** a stale `rev` is ignored, so a revision the rider never saw is never hidden unseen. A dismissed notice keeps its key and id until the source clears it or it expires.
- **Ids are 1–255, round-robin, skipping ids in use;** a full table drops the post.
