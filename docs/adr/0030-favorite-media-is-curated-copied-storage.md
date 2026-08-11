# Favorite Media is curated, copied, favorite-owned storage

Supersedes ADR 0014 (Media History is a local derived view). The derived-on-read photo-library model was already abandoned in practice — Google Play policy blocked broad gallery reads, so media moved to an explicit picker flow that copies files into app storage (`rideMediaFiles.ts`). This ADR makes the current model official and re-keys it to Favorites.

## Contract

- Media attaches only to Favorites. The rider explicitly picks assets; there is no automatic photo-library matching.
- Native owns a `favorite_media` manifest on both platforms. Each immutable row has a native-minted stable UUID primary key, `favorite_id`, capture time, MIME/media kind, byte count, SHA-256 content hash, and creation time.
- Picked files are imported into a canonical per-Favorite/per-media path in app storage. The manifest is durable metadata truth; filenames do not encode metadata.
- Map placement uses the nearest recording-backed GPS fix to capture time, as before. Asset GPS metadata is ignored.
- Deleting a Favorite raw-deletes its manifest rows as a parent-covered cascade and best-effort deletes its media directory. Reconciliation removes incomplete imports and orphaned files.
- Legacy `rideMedia/<sessionId>` folders are left untouched; no migration (PoC).

## Considered Options

- **Keep session-id keying and gate UI to favorites.** Rejected: session ids are derived and unstable; the Favorite is the durable owner.
- **Keep the filesystem as the only record.** Rejected: metadata encoded only in filenames is fragile to enumerate, validate, and reconcile after interrupted operations.
- **Derived photo-library matching scoped to favorites.** Rejected: Play policy already forced the picker model; broad gallery reads are not coming back.
- **Migrate existing per-ride media into intersecting favorites.** Rejected as not worth it for a PoC.

## Consequences

- The native manifest owns durable Favorite Media metadata; app storage owns the local bytes. Assets survive photo-library changes but cost disk space.
- Import and deletion cross SQLite and the filesystem, so reconciliation is required to repair interrupted operations.
- Photos on non-favorited rides are no longer possible; favoriting is the gateway to attaching media.
