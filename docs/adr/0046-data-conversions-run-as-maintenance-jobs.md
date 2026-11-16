# Data conversions run as Maintenance Jobs

A schema change often leaves existing data in an old shape. This decision covers where the work of
bringing that data to the new shape runs.

## Status

Accepted and implemented (#692). The telemetry buffer drain (ADR 0045) is registered in
`MAINTENANCE_JOBS` / `maintenanceJobs`, before Ride summaries.

## Decision

- **Schema migrations stay SQL.** A migration may create, rebuild and index tables, and copy rows
  with set-based statements (`INSERT … SELECT`, `UPDATE … FROM`) that SQLite runs in one pass, as the
  v55 Board key rebuild of `ride_track_points` does. It never runs app code per row.
- **Per-row conversions are Maintenance Jobs.** Work that decodes, encodes, verifies, recomputes or
  fetches for each stored row or minute is declared in `MAINTENANCE_JOBS` / `maintenanceJobs`
  (`docs/history.md` § Maintenance Jobs). Examples: the Ride summaries rebuild, Ride weather and the
  telemetry buffer drain. It gets no runner path of its own.
- **Readers accept both shapes until the job is done.** The schema migration lands the new shape
  next to the old one, and every read path handles both. ADR 0045's merged chunk + buffer reads are
  the model. A half-finished job never hides data.

## Why

A migration runs when the database opens, in one transaction, before anything else may touch it:

- Its duration adds to app start. Per-row work grows with Ride History and is slowest on the phones
  with the most history.
- One bad row rolls the whole migration back, and the database then fails to open on every launch.
- The same conversion is usually needed later anyway: after Restore of an older archive, or for
  leftovers the app could not finish (a minute left unsealed by a killed app).

A Maintenance Job already has what this work needs: short fenced batches, the active-ride rule,
retry after Restore and Clear all, failure reporting, and progress on Settings → Background
updates. A separate path re-implements those and stays invisible to the rider.

## Consequences

- A new conversion is a new `MaintenanceJob` plus a `MaintenanceJobId` in the TS mirror, not a
  migration step or a `MaintenanceRunner` special case.
- Until its job finishes, the database holds both shapes, so storage savings and new read paths
  show up a little after launch, not at it.
- Short fixed-size backfills (a settings row, a handful of Boards) may still live in the migration.
