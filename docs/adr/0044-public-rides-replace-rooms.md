# Public Rides isolate the sharing switch from backups and respect Play Store FGS limits

- **NEVER store the Public Ride switch in `app_settings`:** keep it in its own native store so restoring a database backup onto another phone never silently broadcasts location.
- **Manual sharing override is memory-only:** restarting the app process restores Board Session activation while keeping the selected timed/always expiry.
- **Android Play Store constraint:** background observing MUST run as a plain (non-foreground) service; do NOT add `FOREGROUND_SERVICE_REMOTE_MESSAGING` (rejected by Google Play policy as reserved for VoIP/SMS handover).
- **Privacy & signals:** public positions obey Privacy Zones (ADR-0009); Rider Signals and Ride Hazards retain their explicit opt-in location exception and server-clock expiry.
