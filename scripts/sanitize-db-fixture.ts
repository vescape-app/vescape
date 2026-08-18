import { Database } from 'bun:sqlite'
import { $ } from 'bun'
import { copyFileSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'

import {
  ALERT_PRESET_METRICS,
  ALERT_PRESET_SOURCE,
  generateAlertPresetRules,
  presetAlertRuleId,
  type AlertPresetLevel,
} from '../src/modules/alerts/lib/alertPresets.ts'
import { DEFAULT_BOARD_TOP_SPEED_KMH } from '../src/modules/alerts/lib/boardAlertSettings.ts'

/**
 * Turns a real database backup into the committed screenshot fixture
 * (`shared/fixtures/screenshot-db.zip`) that `bun run screenshots` restores on the device.
 *
 * A raw backup cannot be committed: it carries every ride ever recorded, tens of thousands of
 * diagnostic events, and Privacy Zones that by definition mark the rider's home. This keeps the
 * last few rides and drops the rest:
 *
 *   keep    the N most recent ride windows (same 10-minute gap rule as `history/lib/sessions.ts`)
 *   drop    every other telemetry frame/bucket/marker, all diagnostic events, Privacy Zones,
 *           Board Warnings, favorites, and every board except the one the rides belong to
 *   rename  the device id/MAC to a fixture value; boards and tunes to presentable names
 *   rebase  every timestamp by one offset so the newest ride reads as "today"
 *   vacuum
 *
 * A coordinate offset is deliberately NOT applied: the capture rides were picked to be shareable
 * as they are, and translating a route keeps its shape anyway (see #320).
 *
 * Usage:
 *   bun run scripts/sanitize-db-fixture.ts <backup.zip|db.sqlite> [--rides 2] [--out <zip>]
 */

const ROOT = join(import.meta.dir, '..')
const DEFAULT_OUT = join(ROOT, 'shared', 'fixtures', 'screenshot-db.zip')

/** `history/lib/sessions.ts` `DEFAULT_GAP_MS` — what makes two blocks one ride. */
const RIDE_GAP_MS = 10 * 60_000
/** Frames are kept slightly wider than the bucket window so a ride's edges survive rounding. */
const WINDOW_PADDING_MS = 60_000

/** Stand-in for the real board MAC, applied to the database and expected in the replay fixture. */
const FIXTURE_DEVICE_ID = 'A1:B2:C3:D4:E5:F6'
const FIXTURE_DEVICE_NAME = 'Thor301'
const FIXTURE_BOARD_NAME = 'Thor301'
const FIXTURE_RIDER_NAME = 'Rider'
/** Alert Preset level applied to every metric, so the alerts panel has a normal setup to show. */
const FIXTURE_ALERT_PRESET_LEVEL: AlertPresetLevel = 'normal'
/** Tune profiles are reassigned to the kept board and renamed, oldest first. */
const FIXTURE_TUNE_NAMES = ['Cruise', 'Trail']

interface Args {
  source: string
  rides: number
  out: string
}

function parseArgs(argv: string[]): Args {
  let source: string | null = null
  let rides = 2
  let out = DEFAULT_OUT

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--rides' || arg === '--out') {
      const value = argv[index + 1]
      if (!value) throw new Error(`Missing value for ${arg}`)
      if (arg === '--rides') rides = Number(value)
      else out = value
      index += 1
      continue
    }
    if (arg.startsWith('--rides=')) {
      rides = Number(arg.slice('--rides='.length))
      continue
    }
    if (arg.startsWith('--out=')) {
      out = arg.slice('--out='.length)
      continue
    }
    if (arg.startsWith('--')) throw new Error(`Unknown argument: ${arg}`)
    if (source) throw new Error('Pass exactly one source backup')
    source = arg
    continue
  }

  if (!source)
    throw new Error('Usage: bun run scripts/sanitize-db-fixture.ts <backup.zip|db.sqlite>')
  if (!Number.isInteger(rides) || rides < 1) throw new Error('--rides must be a positive integer')
  return { source, rides, out }
}

interface RideWindow {
  startMs: number
  endMs: number
}

/**
 * Groups minute buckets into rides the way the history screen does, and returns the newest `count`
 * windows in chronological order.
 */
function findRideWindows(db: Database, count: number): RideWindow[] {
  const buckets = db
    .query<{ first: number; last: number }, []>(
      'SELECT first_sample_at_ms AS first, last_sample_at_ms AS last FROM telemetry_minute_buckets ORDER BY bucket_start_ms',
    )
    .all()

  const windows: RideWindow[] = []
  for (const bucket of buckets) {
    const current = windows.at(-1)
    if (current && bucket.first - current.endMs <= RIDE_GAP_MS) {
      current.endMs = Math.max(current.endMs, bucket.last)
      continue
    }
    windows.push({ startMs: bucket.first, endMs: bucket.last })
  }

  if (windows.length < count) {
    throw new Error(`Backup has ${windows.length} ride(s), asked to keep ${count}`)
  }
  return windows.slice(-count)
}

/** `captured_at_ms BETWEEN ...` for every kept window, as one reusable predicate. */
function keepPredicate(column: string, windows: RideWindow[]): string {
  return windows
    .map(
      (w) =>
        `${column} BETWEEN ${w.startMs - WINDOW_PADDING_MS} AND ${w.endMs + WINDOW_PADDING_MS}`,
    )
    .join(' OR ')
}

/** Every timestamp column that must move together so the screens keep agreeing with each other. */
const TIMESTAMP_COLUMNS: Record<string, string[]> = {
  telemetry_frames: ['captured_at_ms', 'location_timestamp_ms'],
  telemetry_minute_buckets: [
    'bucket_start_ms',
    'first_sample_at_ms',
    'last_sample_at_ms',
    'first_moving_at_ms',
    'last_moving_at_ms',
  ],
  telemetry_markers: ['occurred_at_ms'],
  metric_exclusion_ranges: ['start_ms', 'end_ms'],
  boards: ['created_at'],
  board_settings: ['updated_at'],
  tune_profiles: ['created_at', 'updated_at'],
  tune_history_entries: ['created_at'],
  alerts: ['created_at'],
  app_settings: ['updated_at'],
}

/**
 * Gives the kept board the `normal` Alert Preset on every metric, the way the Alerts setup screen
 * would: the same generator the app uses (`alertPresetStore.regenerateMetric`), the same rule ids
 * and `source`, plus the `alertPreset` selection and onboarding flag so the setup UI agrees with
 * the rules. A real backup can have no alerts at all, which leaves the alerts panel blank.
 */
function seedAlertPresets(db: Database, boardId: string): void {
  const setting = (key: string): unknown => {
    const row = db
      .query<{ value_json: string }, [string, string]>(
        'SELECT value_json FROM board_settings WHERE board_id = ? AND key = ?',
      )
      .get(boardId, key)
    return row ? JSON.parse(row.value_json) : null
  }

  const topSpeed = setting('topSpeedKmh')
  const options = {
    boardTopSpeedKmh: typeof topSpeed === 'number' ? topSpeed : DEFAULT_BOARD_TOP_SPEED_KMH,
    hasBatteryConfig: setting('batteryConfig') != null,
  }
  const now = Date.now()

  db.exec('DELETE FROM alerts WHERE board_id = ?', [boardId])
  let count = 0
  for (const metric of ALERT_PRESET_METRICS) {
    generateAlertPresetRules(metric, FIXTURE_ALERT_PRESET_LEVEL, options).forEach((spec, index) => {
      db.exec(
        'INSERT INTO alerts (board_id, id, control_id, threshold, threshold_max, enabled, sound_type, created_at, source) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)',
        [
          boardId,
          presetAlertRuleId(metric, index),
          spec.controlId,
          spec.threshold,
          spec.thresholdMax,
          spec.soundType,
          now,
          ALERT_PRESET_SOURCE,
        ],
      )
      count += 1
    })
  }

  const selection = Object.fromEntries(
    ALERT_PRESET_METRICS.map((metric) => [metric, FIXTURE_ALERT_PRESET_LEVEL]),
  )
  for (const [key, value] of [
    ['alertPreset', selection],
    ['alertPresetsOnboarded', true],
  ] as const) {
    db.exec(
      'INSERT INTO board_settings (board_id, key, value_json, updated_at) VALUES (?, ?, ?, ?)' +
        ' ON CONFLICT(board_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at',
      [boardId, key, JSON.stringify(value), now],
    )
  }

  console.log(`  alerts seeded: ${count} (${FIXTURE_ALERT_PRESET_LEVEL} preset, every metric)`)
}

function sanitize(dbPath: string, rides: number): void {
  const db = new Database(dbPath)
  db.exec('PRAGMA foreign_keys = OFF')

  const windows = findRideWindows(db, rides)
  const kept = keepPredicate('captured_at_ms', windows)

  db.exec('BEGIN')

  // Rides: everything outside the kept windows goes.
  db.exec(`DELETE FROM telemetry_frames WHERE NOT (${kept})`)
  db.exec(
    `DELETE FROM telemetry_minute_buckets WHERE NOT (${keepPredicate('last_sample_at_ms', windows)})`,
  )
  db.exec(`DELETE FROM telemetry_markers WHERE NOT (${keepPredicate('occurred_at_ms', windows)})`)
  db.exec(`DELETE FROM metric_exclusion_ranges WHERE NOT (${keepPredicate('start_ms', windows)})`)

  // Whole tables that are either private (home location, ride history in another shape) or noise.
  db.exec('DELETE FROM diagnostic_events')
  db.exec('DELETE FROM privacy_zones')
  db.exec('DELETE FROM board_warnings')
  db.exec('DELETE FROM favorite_media')
  db.exec('DELETE FROM favorites')

  // One board — the one the kept rides belong to — under a fixture identity.
  const boardId = db
    .query<{ id: string }, []>(
      'SELECT id FROM boards ORDER BY (SELECT COUNT(*) FROM telemetry_minute_buckets WHERE device_id = boards.ble_id) DESC LIMIT 1',
    )
    .get()?.id
  if (!boardId) throw new Error('Backup has no boards')

  db.exec('DELETE FROM board_settings WHERE board_id <> ?', [boardId])
  db.exec('DELETE FROM alerts WHERE board_id <> ?', [boardId])
  db.exec('DELETE FROM boards WHERE id <> ?', [boardId])
  db.exec('UPDATE boards SET name = ?, ble_id = ?', [FIXTURE_BOARD_NAME, FIXTURE_DEVICE_ID])

  seedAlertPresets(db, boardId)

  // Tunes follow the surviving board so the tune panel is not empty.
  const tuneIds = db
    .query<{ id: string }, []>('SELECT id FROM tune_profiles ORDER BY created_at')
    .all()
    .map((row) => row.id)
  tuneIds.slice(FIXTURE_TUNE_NAMES.length).forEach((id) => {
    db.exec('DELETE FROM tune_history_entries WHERE profile_id = ?', [id])
    db.exec('DELETE FROM tune_profiles WHERE id = ?', [id])
  })
  tuneIds.slice(0, FIXTURE_TUNE_NAMES.length).forEach((id, index) => {
    db.exec('UPDATE tune_profiles SET board_id = ?, name = ? WHERE id = ?', [
      boardId,
      FIXTURE_TUNE_NAMES[index],
      id,
    ])
  })

  // The MAC is an identifier of a real board; the joins only need it to be consistent.
  for (const table of ['telemetry_frames', 'telemetry_minute_buckets', 'telemetry_markers']) {
    db.exec(`UPDATE ${table} SET device_id = ?, device_name = ? WHERE device_id IS NOT NULL`, [
      FIXTURE_DEVICE_ID,
      FIXTURE_DEVICE_NAME,
    ])
  }
  db.exec('UPDATE metric_exclusion_ranges SET device_id = ?', [FIXTURE_DEVICE_ID])

  // Settings that carry the rider's identity or last known position.
  db.exec(
    "DELETE FROM app_settings WHERE key IN ('lastGpsLatitude','lastGpsLongitude','directionPointLatitude','directionPointLongitude','riderId','dismissedCommunityMessageIds')",
  )
  db.exec("UPDATE app_settings SET value_json = ? WHERE key = 'riderName'", [
    JSON.stringify(FIXTURE_RIDER_NAME),
  ])
  db.exec("UPDATE app_settings SET value_json = ? WHERE key = 'selectedBoardId'", [
    JSON.stringify(boardId),
  ])

  // Rebase: the newest ride ends now, minute-aligned so bucket keys stay on their minute.
  const lastEnd = windows.at(-1)!.endMs
  const shift = Math.floor((Date.now() - lastEnd) / 60_000) * 60_000
  // `telemetry_minute_buckets` keys on `bucket_start_ms`, and a whole-minute shift lands rows on
  // each other's keys mid-update. Parking them far past every existing key first makes both halves
  // of the move collision-free.
  const PARK = 1_000_000_000_000
  for (const [table, columns] of Object.entries(TIMESTAMP_COLUMNS)) {
    const steps = table === 'telemetry_minute_buckets' ? [PARK, shift - PARK] : [shift]
    for (const step of steps) {
      db.exec(`UPDATE ${table} SET ${columns.map((c) => `${c} = ${c} + ${step}`).join(', ')}`)
    }
  }

  db.exec('COMMIT')
  db.exec('VACUUM')

  const frames = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM telemetry_frames').get()!.n
  const rideList = windows
    .map((w) => new Date(w.startMs + shift).toISOString().slice(0, 16).replace('T', ' '))
    .join(', ')
  console.log(`  rides kept: ${rideList}`)
  console.log(`  frames kept: ${frames}`)
  console.log(`  timestamps shifted by ${(shift / 86_400_000).toFixed(1)} day(s)`)
  db.close()
}

const args = parseArgs(Bun.argv.slice(2))
const work = mkdtempSync(join(tmpdir(), 'vesc-fixture-'))

try {
  const dbPath = join(work, 'db.sqlite')
  const manifestPath = join(work, 'manifest.json')

  if (args.source.endsWith('.zip')) {
    await $`unzip -q -o ${args.source} -d ${work}`
  } else {
    copyFileSync(args.source, dbPath)
  }

  const manifest = (await Bun.file(manifestPath)
    .json()
    .catch(() => null)) as Record<string, unknown> | null
  if (!manifest) throw new Error('Source is missing manifest.json (not a vesc-db-backup zip?)')

  console.log(`Sanitizing ${basename(args.source)} → ${basename(args.out)}`)
  sanitize(dbPath, args.rides)

  manifest.createdAt = Date.now()
  manifest.dbSizeBytes = statSync(dbPath).size
  writeFileSync(manifestPath, JSON.stringify(manifest))

  rmSync(args.out, { force: true })
  await $`zip -q -j ${args.out} ${dbPath} ${manifestPath}`
  console.log(`  ${args.out} (${(statSync(args.out).size / 1_000_000).toFixed(1)} MB)`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
