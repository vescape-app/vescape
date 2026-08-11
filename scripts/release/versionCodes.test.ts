import { describe, expect, test } from 'bun:test'
import { allocateAndroidArtifactCodes } from './versionCodes'

describe('allocateAndroidArtifactCodes', () => {
  test('allocates stable disjoint codes for a workflow run', () => {
    expect(allocateAndroidArtifactCodes(42)).toEqual({ phone: 100_000_042, wear: 1_100_000_042 })
    expect(allocateAndroidArtifactCodes(42)).toEqual(allocateAndroidArtifactCodes(42))
  })

  test('increases both codes for repeated builds of one marketing version', () => {
    const first = allocateAndroidArtifactCodes(42)
    const second = allocateAndroidArtifactCodes(43)
    expect(second.phone).toBeGreaterThan(first.phone)
    expect(second.wear).toBeGreaterThan(first.wear)
  })

  test.each([0, -1, 1.5, Number.NaN])('rejects invalid run number %s', (runNumber) => {
    expect(() => allocateAndroidArtifactCodes(runNumber)).toThrow('Invalid workflow run number')
  })

  test('rejects codes beyond the Play limit', () => {
    expect(() => allocateAndroidArtifactCodes(1_000_000_001)).toThrow('exceeds the Play limit')
  })
})
