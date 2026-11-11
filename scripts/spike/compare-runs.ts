#!/usr/bin/env bun
/**
 * Spike #658: side-by-side table of SDK benchmark results.
 *
 *   bun scripts/spike/compare-runs.ts a.json b.json [c.json ...]
 *
 * Each input is either one result JSON or a raw log (`adb logcat`, iOS console) that contains
 * `SPIKE_RESULT {...}` lines or `SPIKE_RESULT_PART <id> i/n ...` chunks; every result found counts.
 * The first result is the baseline; later columns show the delta to it.
 */
import type {
  BenchResult,
  PhaseResult,
} from '../../src/modules/map/screens/benchmark/benchmarkRecorder'
import { BENCH_PHASES } from '../../src/modules/map/screens/benchmark/benchmarkScript'
import { parseInput } from './benchLog'

type Metric = [name: string, read: (p: PhaseResult) => number | undefined]

const METRICS: Metric[] = [
  ['js p50 ms', (p) => p.js.p50],
  ['js p95 ms', (p) => p.js.p95],
  ['js p99 ms', (p) => p.js.p99],
  ['js >33ms', (p) => p.js.over33],
  ['js dropped', (p) => p.js.dropped],
  ['ui p95 ms', (p) => p.ui?.p95],
  ['ui >33ms', (p) => p.ui?.over33],
  ['ui dropped', (p) => p.ui?.dropped],
  ['write avg ms', (p) => p.write.avg],
  ['write p95 ms', (p) => p.write.p95],
  ['write max ms', (p) => p.write.max],
  ['echo/write %', (p) => (p.write.n ? Math.round((p.echo.n / p.write.n) * 100) : 0)],
  ['matched %', (p) => (p.echo.n ? Math.round((p.echo.matched / p.echo.n) * 100) : 0)],
  ['mixed %', (p) => (p.echo.matched ? Math.round((p.echo.mixed / p.echo.matched) * 100) : 0)],
  ['lag p95 writes', (p) => p.echo.lagP95],
  ['lag max writes', (p) => p.echo.lagMax],
  ['lag p95 ms', (p) => p.echo.lagMsP95],
  ['drawn jump m', (p) => p.echo.maxDrawnJumpM],
]

const runs = process.argv.slice(2).flatMap(parseInput)
if (runs.length < 2) {
  console.error('usage: bun scripts/spike/compare-runs.ts <result|log> <result|log> [...]')
  process.exit(1)
}

const fmt = (v: number | undefined) => (v === undefined ? '-' : String(Math.round(v * 100) / 100))
const delta = (v: number | undefined, base: number | undefined) => {
  if (v === undefined || base === undefined) return ''
  const d = v - base
  const pct = base !== 0 ? ` ${d >= 0 ? '+' : ''}${Math.round((d / base) * 100)}%` : ''
  return ` (${d >= 0 ? '+' : ''}${fmt(d)}${pct})`
}

const header = ['', ...runs.map((r) => r.label)]
const meta = (name: string, read: (r: BenchResult) => string | number) => [
  name,
  ...runs.map((r) => String(read(r.result))),
]
const rows: string[][] = [
  meta('sdk', (r) => r.sdk),
  meta('style', (r) => r.style),
  meta('device', (r) => `${r.platform} ${r.osVersion} ${r.device}`),
  meta('build', (r) => `${r.build} ${r.appVersion}`),
  meta('started', (r) => r.startedAt),
  meta('duration ms', (r) => r.durationMs),
]
for (const phase of [...BENCH_PHASES, 'total'] as const) {
  rows.push([`[${phase}]`, ...runs.map(() => '')])
  for (const [name, read] of METRICS) {
    const pick = (r: BenchResult) => read(phase === 'total' ? r.total : r.phases[phase])
    const base = pick(runs[0]!.result)
    rows.push([
      `  ${name}`,
      ...runs.map((r, i) => fmt(pick(r.result)) + (i === 0 ? '' : delta(pick(r.result), base))),
    ])
  }
}

const widths = header.map((_, c) => Math.max(...[header, ...rows].map((row) => row[c]!.length)))
const print = (row: string[]) =>
  console.log(
    row
      .map((cell, c) => (c === 0 ? cell.padEnd(widths[c]!) : cell.padStart(widths[c]!)))
      .join('  '),
  )
print(header)
for (const row of rows) print(row)
