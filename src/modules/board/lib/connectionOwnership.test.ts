import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(import.meta.dir, '../../../..')

const kotlin = readFileSync(
  join(
    repoRoot,
    'modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt',
  ),
  'utf8',
)
const swift = readFileSync(
  join(repoRoot, 'modules/vescape-core/ios/connection/BoardSessionController.swift'),
  'utf8',
)

/** Body of the first brace-balanced block starting at `header`. */
function body(source: string, header: string): string {
  const start = source.indexOf(header)
  if (start < 0) throw new Error(`missing ${header}`)
  let depth = 0
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`unbalanced ${header}`)
}

/**
 * The connection owner registry (ADR 0035) has no expiry: an owner that is claimed and never
 * released denies every later claim for the life of the process. Both platforms already shipped
 * that bug once — a Board Session kept ownership after the ride ended, so the next Presence Scan
 * and the next Auto Start were refused forever. These are the release sites that must not vanish.
 */
describe('connection ownership lifecycle', () => {
  test('Android releases the Board Session owner on teardown', () => {
    expect(body(kotlin, 'private fun stopCurrentBoardSession(')).toContain(
      'ConnectionOwnership.shared.release(ConnectionOwner.BoardSession)',
    )
  })

  test.each(['private func endSession(', 'private func fail('])(
    'iOS releases the Board Session owner in %s',
    (header) => {
      expect(body(swift, header)).toContain('ConnectionOwnership.shared.release(.boardSession)')
    },
  )

  test('iOS claims the Board Session owner when a session starts', () => {
    expect(body(swift, 'private func beginSession(')).toContain(
      'ConnectionOwnership.shared.request(.boardSession)',
    )
  })

  test.each([
    ['Android', kotlin, 'fun beginExplicitConnect('],
    ['iOS', swift, 'func beginExplicitConnect('],
  ])('%s explicit Connect preempts a running Presence Scan', (_platform, source, header) => {
    expect(body(source, header)).toContain('presenceScan.cancel(')
  })
})
