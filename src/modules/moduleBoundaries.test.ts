import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ALLOWED_EDGES = new Set([
  'alerts -> board',
  'battery -> board',
  'group-ride -> board',
  'history -> board',
  'tune -> board',
  'alerts -> battery',
  'board -> battery',
  'accessories -> settings',
  'alerts -> settings',
  'board -> settings',
  'history -> settings',
  'legal -> settings',
  'history -> weather',
  'weather -> settings',
  'release -> settings',
  'settings -> alerts',
  'settings -> history',
  'settings -> legal',
  'settings -> map',
  'group-ride -> map',
  'group-ride -> profile',
  'profile -> location',
  'profile -> map',
  'map-points -> map',
  'board -> alerts',
  'board -> history',
  'diagnostics -> board',
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
