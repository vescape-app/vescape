import { describe, expect, test } from 'bun:test'
import { resolveEditorCommand } from './editor'

describe('release-note editor selection', () => {
  test('uses the configured editor and verifies it exists', () => {
    expect(resolveEditorCommand({ EDITOR: 'zed --wait' }, (program) => program === 'zed')).toEqual([
      'zed',
      '--wait',
    ])
    expect(() => resolveEditorCommand({ VISUAL: 'missing' }, () => false)).toThrow('not installed')
  })

  test('prefers Zed with wait mode when the shell has no editor', () => {
    expect(resolveEditorCommand({}, (program) => program === 'zed')).toEqual(['zed', '--wait'])
  })
})
