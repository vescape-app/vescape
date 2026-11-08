import { describe, expect, test } from 'bun:test'
import { androidVersionCode } from './version'

describe('androidVersionCode', () => {
  test('maps the package version to a monotonically increasing Android version code', () => {
    expect(androidVersionCode('0.56.0')).toBe(56_000)
    expect(androidVersionCode('1.2.3')).toBe(1_002_003)
    expect(androidVersionCode('0.100.0')).toBe(100_000)
  })

  test.each(['1.2', '1.2.3.4', '1.two.3', '-1.2.3', '1.1000.0', '1.2.1000'])(
    'rejects invalid package version %s',
    (version) => {
      expect(() => androidVersionCode(version)).toThrow(`Invalid version "${version}"`)
    },
  )

  test('uses a validated release allocation when supplied', () => {
    expect(androidVersionCode('0.83.1', '100000042')).toBe(100_000_042)
    expect(() => androidVersionCode('0.83.1', '0')).toThrow('Invalid Android release version code')
    expect(() => androidVersionCode('0.83.1', '2100000001')).toThrow(
      'Invalid Android release version code',
    )
  })
})
