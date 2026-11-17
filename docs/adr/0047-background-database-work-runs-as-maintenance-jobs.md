# Background database work runs as Maintenance Jobs

ADR 0046 put data conversions into Maintenance Jobs. Other work also runs on the database outside a
rider action: retention clean-up such as deleting old Diagnostic Events. This decision covers where
all of it runs.

## Status

Accepted. The telemetry buffer drain moved into the `telemetryStorage` job (#692), and Diagnostic
Event retention into the `cleanup` job.

## Decision

- **Every piece of background database work is a Maintenance Job** in `MAINTENANCE_JOBS` /
  `maintenanceJobs` (`docs/history.md` § Maintenance Jobs): conversions, rebuilds, backfills and
  clean-up. `MaintenanceRunner` only schedules jobs; it calls no database work of its own.
- **Clean-up is one job, `cleanup`**, that runs a plain list of steps. A new retention rule is a new
  step, not a new job or runner path. One failed step is reported and the rest still run.
- **Recording and the rider's own actions stay outside.** Live sealing during a ride, Backup,
  Restore, Clear all and other work the rider starts and watches are not Maintenance Jobs.

## Why

- **One place to look.** Settings → Database → Maintenance lists every job with its status, last
  run, duration and error. Work outside the list is invisible to the rider and to us when a database
  grows or a launch is slow.
- **One set of rules.** Jobs already have fenced batches, the active-ride rule, retry after Restore
  and Clear all, and failure reporting. A side path re-implements them and drifts.

## Consequences

- New background work adds a job (or a `cleanup` step) plus its `MaintenanceJobId` in
  `src/modules/settings/lib/maintenance.ts`.
- Work that must repeat (every launch, after Restore) uses the same per-launch and database
  generation completion as `telemetryStorage`, so its row shows when it last ran.
