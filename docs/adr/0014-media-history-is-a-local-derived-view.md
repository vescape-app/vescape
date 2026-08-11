# Media History is a local derived view

> **Superseded by ADR 0030.** Google Play policy blocked broad gallery reads; media moved to an explicit picker flow with copied, Favorite-owned storage.

Media History displays phone photos and videos alongside a selected Ride Recording without making those assets part of durable Ride History. The OS photo library remains durable media truth; native Ride Recording storage remains durable ride truth. Matching is recomputed when Media History is read for a selected ride and is not persisted.

## Matching Contract

- An asset qualifies only when its capture time is inside the selected Ride Recording's inclusive `[startAtMs, endAtMs]` range.
- Capture time is the OS photo library asset's creation timestamp. Assets without a valid creation timestamp are excluded; file modification time is not a fallback.
- A video's creation timestamp is interpreted as its playback start timestamp.
- Asset GPS metadata is ignored.
- Map position is the nearest recording-backed GPS fix to asset capture time, with a maximum absolute difference of `30_000ms`.
- A continuous recording-backed GPS span contains adjacent GPS fixes no more than `30_000ms` apart. Explicit Ride History `gap` markers and ride-boundary markers (`disconnected`, `app_stop`, or `error`) always split spans. Span coverage starts at its first fix and ends at its last fix; it does not extend by the matching tolerance.
- Asset capture time and its candidate GPS fix must be inside the same continuous recording-backed GPS span. A match is rejected when no such fix is within tolerance. These rules prevent matching into or across unsupported spans such as GPS outages and Privacy Zone gaps.

## Permission And Availability

- Media History is off by default. Photo-library permission is requested only after the user explicitly enables it.
- Full permission shows all qualifying assets. Limited permission shows only qualifying assets made available by the OS. Denied or restricted permission leaves Media History empty without affecting Ride History.
- The UI must explain denied, restricted, and limited access and offer the relevant OS permission-management action.
- Missing, deleted, inaccessible, or unreadable assets are omitted. Losing an asset never mutates or invalidates its Ride Recording.

## Read And Ownership Rules

- Each selected-ride Media History read queries currently accessible OS photo-library assets in that ride's time range, then derives matches from current selected Ride History data.
- Results may be cached in memory only for the active selected-ride read. They must be discarded when the selected ride changes, Media History is disabled, permission changes, or a fresh read is requested.
- No asset, thumbnail, asset-to-ride link, media metadata, or route is copied into durable app storage, uploaded, or published.
- Reading Media History does not mutate durable Ride History. It is separate from precomputed Ride History summaries governed by ADR 0005.

## Considered Options

- **Persist asset-to-ride matches.** Rejected because OS assets can be deleted or access can change, making persisted links stale and turning app storage into competing media truth.
- **Use asset GPS metadata.** Rejected because media position must follow recording-backed route truth and must not reveal locations omitted from Ride History.
- **Match the nearest GPS fix without a span and distance limit.** Rejected because it can place media inside or across GPS outages, Privacy Zone gaps, or recording gaps.
- **Request photo access when Ride History opens.** Rejected because media access is optional and should follow explicit user intent.

## Consequences

- Media History can change when photo-library contents or permission change, while the Ride Recording remains unchanged.
- Limited permission may produce a partial Media History view.
- Assets near a ride boundary or gap may be excluded even when their own GPS metadata exists.
- Video telemetry synchronization can use video creation time plus playback position, subject to the same Ride Recording gap rules.
