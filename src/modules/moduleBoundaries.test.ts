import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Cross-module import ratchet. `src/modules/<a>` importing `src/modules/<b>` is
 * only allowed when `a -> b` is listed below. Shrink this list over time —
 * never grow it without an ADR-level reason.
 */
const ALLOWED_EDGES = new Set([
  // board is the session/telemetry hub; most domains read its stores/constants
  'alerts -> board',
  'battery -> board',
  'group-ride -> board',
  'history -> board',
  'tune -> board',
  // battery config is a clean leaf board and alerts derive from
  'alerts -> battery',
  'board -> battery',
  // settings store is app-settings truth read by domain stores
  'alerts -> settings',
  'board -> settings',
  'history -> settings',
  'legal -> settings',
  // release reads/persists dismissed Community Message IDs through App Settings
  'release -> settings',
  // settings defaults sourced from owning domains
  'settings -> alerts',
  'settings -> history',
  'settings -> legal',
  'settings -> map',
  // rider trails/pins are map layers and share map rendering defaults
  'group-ride -> map',
  // Map Points are read around the map camera and share its navigation target type
  'map-points -> map',
  // TODO(decouple): board components read alertsStore + history color scale
  'board -> alerts',
  'board -> history',
  // DevBadge toggles debug session recording on the board store
  'diagnostics -> board',
  // TODO(decouple): AlertFormModal renders TuneDial
  'alerts -> tune',
])

const modulesDir = join(import.meta.dir)

const listFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return listFiles(full)
    return /\.(ts|tsx)$/.test(name) ? [full] : []
  })

describe('module boundaries', () => {
  test('cross-module imports stay within allowed edges', () => {
    const violations: string[] = []
    for (const file of listFiles(modulesDir)) {
      const rel = relative(modulesDir, file)
      const from = rel.split('/')[0]!
      if (!statSync(join(modulesDir, from)).isDirectory()) continue
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/['"]@\/modules\/([^/'"]+)/g)) {
        const to = match[1]!
        if (to !== from && !ALLOWED_EDGES.has(`${from} -> ${to}`)) {
          violations.push(`${rel}: ${from} -> ${to}`)
        }
      }
      // modules sit below the composition layer and must never reach up into it
      if (/['"]@\/(screens|app|bootstrap)\//.test(source)) {
        violations.push(`${rel}: ${from} -> composition layer (screens/app/bootstrap)`)
      }
    }
    expect(violations).toEqual([])
  })

  test('flat kit stays domain-less', () => {
    const srcDir = join(modulesDir, '..')
    const violations: string[] = []
    for (const flat of ['components', 'hooks', 'helpers']) {
      for (const file of listFiles(join(srcDir, flat))) {
        const source = readFileSync(file, 'utf8')
        if (/['"]@\/(modules|screens|app|bootstrap)\//.test(source)) {
          violations.push(relative(srcDir, file))
        }
      }
    }
    expect(violations).toEqual([])
  })
})
