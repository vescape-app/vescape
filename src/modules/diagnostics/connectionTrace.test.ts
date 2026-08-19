import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
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
