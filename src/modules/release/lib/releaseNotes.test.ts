import { describe, expect, test } from 'bun:test'

import { compareMarketingVersions, parseMarketingVersion, selectReleaseNotes } from './releaseNotes'

describe('release-note selection', () => {
  test('shows installed and older versions newest-first', () => {
    const notes = [
      { version: '0.83.0', markdown: 'old' },
      { version: '0.84.0', markdown: 'future' },
      { version: '0.83.1', markdown: 'current' },
    ]

    expect(selectReleaseNotes(notes, '0.83.1')).toEqual([
      { version: '0.83.1', markdown: 'current' },
      { version: '0.83.0', markdown: 'old' },
    ])
  })

  test('parses and compares full marketing versions only', () => {
    expect(parseMarketingVersion('1.12')).toBeNull()
    expect(parseMarketingVersion('latest')).toBeNull()
    expect(compareMarketingVersions('1.12.0', '1.11.9')).toBeGreaterThan(0)
    expect(compareMarketingVersions('1.12.0-rc.1', '1.12.0')).toBeLessThan(0)
  })

  test('tolerates missing notes for the installed version', () => {
    expect(selectReleaseNotes([{ version: '0.83.0', markdown: 'old' }], '0.84.0')).toEqual([
      { version: '0.83.0', markdown: 'old' },
    ])
  })

  test('orders prereleases before their final release', () => {
    expect(compareMarketingVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBeLessThan(0)
    expect(compareMarketingVersions('1.0.0', '1.0.0-rc.10')).toBeGreaterThan(0)
  })

  test('selects notes when the runtime does not provide Array.toSorted', () => {
    /* eslint-disable no-extend-native -- deliberately stubbing the prototype to test the fallback */
    const original = Array.prototype.toSorted
    Object.defineProperty(Array.prototype, 'toSorted', { configurable: true, value: undefined })
    try {
      expect(selectReleaseNotes([{ version: '1.0', markdown: 'Current' }], '1.0')).toEqual([
        { version: '1.0', markdown: 'Current' },
      ])
    } finally {
      Object.defineProperty(Array.prototype, 'toSorted', {
        configurable: true,
        value: original,
        writable: true,
      })
    }
  })
})
