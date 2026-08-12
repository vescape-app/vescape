import { describe, expect, test } from 'bun:test'

import {
  REFERENCE_WHEEL_DIAMETER_METERS,
  TUNE_PREVIEW_PIXELS_PER_METER,
  TUNE_PREVIEW_WHEEL_RADIUS_PIXELS,
  responseLeanAngleDegrees,
  terrainHeightRelativeToWheel,
  tunePreviewDeckLine,
} from '@/modules/tune/lib/tunePreviewGeometry'

describe('Tune Preview deck geometry', () => {
  test('renders a positive nose-lift angle with the left-side nose above the tail', () => {
    const line = tunePreviewDeckLine(10, 100, 50, 40)

    expect(line.x1).toBeLessThan(line.x2)
    expect(line.y1).toBeLessThan(line.y2)
  })

  test('renders a negative regen angle with the left-side nose below the tail', () => {
    const line = tunePreviewDeckLine(-10, 100, 50, 40)

    expect(line.y1).toBeGreaterThan(line.y2)
  })

  test('uses the rendered 11-inch wheel as the shared one-to-one terrain scale', () => {
    expect(REFERENCE_WHEEL_DIAMETER_METERS * TUNE_PREVIEW_PIXELS_PER_METER).toBeCloseTo(
      TUNE_PREVIEW_WHEEL_RADIUS_PIXELS * 2,
    )
  })

  test('renders valley-to-peak terrain height at the same physical scale as the wheel', () => {
    const heightMeters = 2
    const spacingMeters = 20
    const quarterWavePixels = (spacingMeters / 4) * TUNE_PREVIEW_PIXELS_PER_METER
    const peak = terrainHeightRelativeToWheel(quarterWavePixels, 0, heightMeters, spacingMeters)
    const valley = terrainHeightRelativeToWheel(-quarterWavePixels, 0, heightMeters, spacingMeters)

    expect(peak - valley).toBeCloseTo(heightMeters * TUNE_PREVIEW_PIXELS_PER_METER)
  })

  test('maps low aggressiveness near deck contact and high aggressiveness to a slight lean', () => {
    const contactAngle = (Math.asin(TUNE_PREVIEW_WHEEL_RADIUS_PIXELS / 72) * 180) / Math.PI
    const soft = responseLeanAngleDegrees(0)
    const medium = responseLeanAngleDegrees(5)
    const firm = responseLeanAngleDegrees(10)

    expect(soft).toBeCloseTo(contactAngle * 0.84)
    expect(soft).toBeGreaterThan(medium)
    expect(medium).toBeGreaterThan(firm)
    expect(firm).toBe(2)
  })
})
