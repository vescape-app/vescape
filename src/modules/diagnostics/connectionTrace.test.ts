import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  CONNECTION_TRACE_BAD_EVENTS,
  CONNECTION_TRACE_DECISION,
  CONNECTION_TRACE_EVENT,
  CONNECTION_TRACE_FIELD,
  CONNECTION_TRACE_GOOD_EVENTS,
  CONNECTION_TRACE_INFO_EVENTS,
  CONNECTION_TRACE_ORIGIN,
  CONNECTION_TRACE_OWNER,
  CONNECTION_TRACE_REASON,
  CONNECTION_TRACE_WARNING_EVENTS,
} from '@/modules/diagnostics/connectionTrace'

const repoRoot = join(import.meta.dir, '../../..')

const kotlin = readFileSync(
  join(
    repoRoot,
    'modules/vescape-core/android/src/main/java/expo/modules/vescapecore/diagnostics/ConnectionTrace.kt',
  ),
  'utf8',
)
const swift = readFileSync(
  join(repoRoot, 'modules/vescape-core/ios/diagnostics/ConnectionTrace.swift'),
  'utf8',
)

/** Values of `const val NAME = "value"` inside one Kotlin `object Name { ... }` block. */
function kotlinValues(objectName: string): string[] {
  const body = blockBody(kotlin, `object ${objectName} {`)
  return [...body.matchAll(/const val [A-Z0-9_]+ = "([^"]+)"/g)].map((match) => match[1])
}

/** Values of `static let name = "value"` inside one Swift `enum Name { ... }` block. */
function swiftValues(enumName: string): string[] {
  const body = blockBody(swift, `enum ${enumName} {`)
  return [...body.matchAll(/static let [A-Za-z0-9]+ = "([^"]+)"/g)].map((match) => match[1])
}

function blockBody(source: string, header: string): string {
  const start = source.indexOf(header)
  if (start < 0) throw new Error(`missing block: ${header}`)
  let depth = 0
  for (let i = start + header.length - 1; i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(start + header.length, i)
    }
  }
  throw new Error(`unterminated block: ${header}`)
}

const groups = [
  ['ConnectionTraceEvent', CONNECTION_TRACE_EVENT],
  ['ConnectionTraceOwner', CONNECTION_TRACE_OWNER],
  ['ConnectionTraceOrigin', CONNECTION_TRACE_ORIGIN],
  ['ConnectionTraceField', CONNECTION_TRACE_FIELD],
  ['ConnectionTraceDecision', CONNECTION_TRACE_DECISION],
  ['ConnectionTraceReason', CONNECTION_TRACE_REASON],
] as const

describe('connection trace contract parity', () => {
  for (const [nativeName, tsGroup] of groups) {
    test(`${nativeName} is identical on Android, iOS, and TS`, () => {
      const expected = Object.values(tsGroup).sort()
      expect(kotlinValues(nativeName).sort()).toEqual(expected)
      expect(swiftValues(nativeName).sort()).toEqual(expected)
    })
  }

  test('sensitive field markers are identical on both platforms', () => {
    const markers = (source: string, header: string, closer: string) => {
      const start = source.indexOf(header)
      expect(start).toBeGreaterThan(-1)
      const end = source.indexOf(closer, start)
      return [...source.slice(start + header.length, end).matchAll(/"([a-z_]+)"/g)]
        .map((match) => match[1])
        .sort()
    }

    const android = markers(kotlin, 'private val SENSITIVE_MARKERS = listOf(', ')')
    const ios = markers(swift, 'private static let sensitiveMarkers = [', ']')
    expect(android).toEqual(ios)
    expect(android).toContain('token')
    expect(android).toContain('pin')
    expect(android).toContain('telemetry')
  })

  test('every event name has an Event Log severity bucket', () => {
    const bucketed = new Set([
      ...CONNECTION_TRACE_GOOD_EVENTS,
      ...CONNECTION_TRACE_INFO_EVENTS,
      ...CONNECTION_TRACE_WARNING_EVENTS,
      ...CONNECTION_TRACE_BAD_EVENTS,
    ])
    expect(Object.values(CONNECTION_TRACE_EVENT).filter((name) => !bucketed.has(name))).toEqual([])
  })
})

/**
 * #414 audit guard. A contract event nobody emits is a workflow the Event Log cannot reconstruct,
 * so an unemitted name is a test failure rather than a silently dead constant. Exemptions are
 * explicit and must name the platform difference that justifies them.
 */
const androidSources = nativeSources(
  'modules/vescape-core/android/src/main/java/expo/modules/vescapecore',
  '.kt',
)
const iosSources = nativeSources('modules/vescape-core/ios', '.swift')

/** Emission sites only: the contract file itself declares the names, it does not emit them. */
function nativeSources(relativeDir: string, extension: string): string {
  const root = join(repoRoot, relativeDir)
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'build' || entry.name === 'test' || entry.name === '.build') continue
        walk(path)
        continue
      }
      if (!entry.name.endsWith(extension)) continue
      if (entry.name.startsWith('ConnectionTrace')) continue
      if (entry.name.endsWith(`Tests${extension}`) || entry.name.endsWith(`Test${extension}`)) {
        continue
      }
      files.push(path)
    }
  }
  walk(root)
  return files.map((path) => readFileSync(path, 'utf8')).join('\n')
}

/** Member name → wire value, read from each contract file, so nothing has to guess the casing. */
function memberIndex(source: string, header: string, pattern: RegExp): Map<string, string> {
  const body = blockBody(source, header)
  return new Map([...body.matchAll(pattern)].map((match) => [match[2], match[1]]))
}

const kotlinEventMembers = memberIndex(
  kotlin,
  'object ConnectionTraceEvent {',
  /const val ([A-Z0-9_]+) = "([a-z_]+)"/g,
)
const swiftEventMembers = memberIndex(
  swift,
  'enum ConnectionTraceEvent {',
  /static let ([A-Za-z0-9]+) = "([a-z_]+)"/g,
)

/**
 * Names deliberately emitted on one platform only. Both halves of the contract stay defined so the
 * three files remain value-identical; only the emission is platform-shaped.
 */
const emissionExemptions: Record<string, 'android' | 'ios'> = {
  // Android Auto Start is a Companion Device Manager feature with no iOS peer (ADR 0035).
  auto_start_armed: 'android',
  auto_start_triggered: 'android',
  auto_start_skipped: 'android',
  // Foreground-service ownership is Android-only; iOS covers the same handoff with a background
  // task (`background_task_*`), which Android in turn never emits.
  foreground_work_acquired: 'android',
  foreground_work_released: 'android',
  connection_service_demoted_background: 'android',
  background_task_started: 'ios',
  background_task_ended: 'ios',
  background_task_expired: 'ios',
}

describe('connection trace emission coverage (#414)', () => {
  for (const value of Object.values(CONNECTION_TRACE_EVENT)) {
    test(`${value} is emitted by native code`, () => {
      // The workflow envelope is emitted by `ConnectionTrace` itself, which is excluded above.
      if (
        value === CONNECTION_TRACE_EVENT.workflowStarted ||
        value === CONNECTION_TRACE_EVENT.workflowFinished
      ) {
        return
      }
      const kotlinMember = kotlinEventMembers.get(value)
      const swiftMember = swiftEventMembers.get(value)
      const exemption = emissionExemptions[value]
      if (exemption !== 'ios') {
        expect(androidSources.includes(`ConnectionTraceEvent.${kotlinMember}`)).toBe(true)
      }
      if (exemption !== 'android') {
        expect(iosSources.includes(`ConnectionTraceEvent.${swiftMember}`)).toBe(true)
      }
    })
  }

  test('every workflow terminal uses a canonical reason constant', () => {
    // `finish(...)` is the terminal branch of a workflow: a raw string there is a reason outside
    // the contract, which is exactly what the audit forbids.
    const kotlinFinishes = [...androidSources.matchAll(/\.finish\(\s*([^)]*?)\)/gs)]
    const swiftFinishes = [...iosSources.matchAll(/\.finish\(\s*decision:([^)]*?)\)/gs)]
    const offenders = [...kotlinFinishes, ...swiftFinishes]
      .map((match) => match[1])
      .filter((args) => /"[a-z_]+"/.test(args))
    expect(offenders).toEqual([])
  })
})
