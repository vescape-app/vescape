import { expect, test } from 'bun:test'

import {
  findClosestRainViewerFrameIndex,
  type RainViewerRadarFrame,
} from '@/modules/weather/store/rainViewerRadarStore'

const frames: RainViewerRadarFrame[] = [
  { time: 1_000, path: '/first' },
  { time: 1_600, path: '/second' },
  { time: 2_200, path: '/third' },
]

test('findClosestRainViewerFrameIndex selects nearest available radar frame', () => {
  expect(findClosestRainViewerFrameIndex(frames, 1_600)).toBe(1)
  expect(findClosestRainViewerFrameIndex(frames, 1_950)).toBe(2)
  expect(findClosestRainViewerFrameIndex(frames, 100)).toBe(0)
  expect(findClosestRainViewerFrameIndex(frames, 3_000)).toBe(2)
})

test('findClosestRainViewerFrameIndex handles missing radar frames', () => {
  expect(findClosestRainViewerFrameIndex([], 1_600)).toBe(-1)
})
