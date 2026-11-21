# Favorite Media uses explicit picker copies and ignores EXIF GPS

Google Play policy forbids broad photo-library reads, so media MUST come from an explicit OS picker, attach only to a Favorite, and be copied into Favorite-owned app storage tracked by the native `favorite_media` manifest (never re-introduce automatic gallery scanning or encode metadata in filenames).

**Placement & privacy rule:** map placement MUST IGNORE the asset's EXIF GPS metadata (so media never leaks locations dropped by Privacy Zones, ADR-0009) and require a recording-backed GPS fix within 30 s inside the same continuous recorded span.
