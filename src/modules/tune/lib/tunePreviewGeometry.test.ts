import { describe, expect, test } from 'bun:test'

import {
  REFERENCE_WHEEL_DIAMETER_METERS,
  TUNE_PREVIEW_PIXELS_PER_METER,
  TUNE_PREVIEW_WHEEL_RADIUS_PIXELS,
  terrainHeightRelativeToWheel,
  tunePreviewDeckLine,
} from '@/modules/tune/lib/tunePreviewGeometry'

describe('Tune Preview deck geometry', () => {
  test('renders a positive tail-lift angle with the right-side nose above the tail', () => {
    const line = tunePreviewDeckLine(10, 100, 50, 40)

    expect(line.x1).toBeLessThan(line.x2)
    expect(line.y1).toBeGreaterThan(line.y2)
  })

  test('renders a negative nose-drive angle with the right-side nose below the tail', () => {
    const line = tunePreviewDeckLine(-10, 100, 50, 40)

    expect(line.y1).toBeLessThan(line.y2)
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
    const valley = terrainHeightRelativeToWheel(quarterWavePixels, 0, heightMeters, spacingMeters)
    const peak = terrainHeightRelativeToWheel(-quarterWavePixels, 0, heightMeters, spacingMeters)

    expect(peak - valley).toBeCloseTo(heightMeters * TUNE_PREVIEW_PIXELS_PER_METER)
  })
})
