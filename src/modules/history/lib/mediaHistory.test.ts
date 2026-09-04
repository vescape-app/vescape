import { describe, expect, test } from 'bun:test'
import type { HistoryGpsSample, HistoryMarker } from 'vescape-core'

import { makeSample } from '@/test-utils/factories'
import {
  clusterMediaHistoryAssets,
  findVideoTelemetrySample,
  matchMediaHistoryAssets,
  resolvePickedAssetCreationTime,
  type MediaAssetInput,
  type MediaHistoryAsset,
} from '@/modules/history/lib/mediaHistory'

function gps(id: number, capturedAtMs: number, latitude = 52, longitude = 21): HistoryGpsSample {
  return {
    id,
    capturedAtMs,
    boardId: 'board',
    boardName: 'Board',
    latitude,
    longitude,
    speedMps: null,
    bearingDeg: null,
    accuracyM: null,
    altitudeM: null,
    timestamp: capturedAtMs,
    distanceFromPreviousM: null,
  }
}

function asset(id: string, creationTime: number): MediaAssetInput {
  return {
    id,
    creationTime,
    uri: `file://${id}.jpg`,
    filename: `${id}.jpg`,
    mediaType: 'photo',
  }
}

function marker(occurredAtMs: number, type: HistoryMarker['type']): HistoryMarker {
  return {
    id: occurredAtMs,
    occurredAtMs,
    type,
    boardId: null,
    message: null,
    gapMs: null,
  }
}

describe('matchMediaHistoryAssets', () => {
  test('matches inclusive ride boundary and nearest recording-backed GPS', () => {
    const result = matchMediaHistoryAssets({
      assets: [asset('start', 1_000), asset('middle', 5_000), asset('end', 9_000)],
      gpsSamples: [gps(1, 1_000), gps(2, 5_000), gps(3, 9_000)],
      markers: [],
      startAtMs: 1_000,
      endAtMs: 9_000,
    })
    expect(result.map((item) => item.id)).toEqual(['start', 'middle', 'end'])
  })

  test('rejects asset outside GPS span or across explicit gap', () => {
    const samples = [gps(1, 1_000), gps(2, 9_000), gps(3, 30_000), gps(4, 38_000)]
    expect(
      matchMediaHistoryAssets({
        assets: [asset('before', 500), asset('gap', 25_000), asset('marker-gap', 35_000)],
        gpsSamples: samples,
        markers: [marker(27_000, 'gap'), marker(34_000, 'gap')],
        startAtMs: 0,
        endAtMs: 40_000,
      }),
    ).toEqual([])
  })

  test('rejects assets outside the ride, tolerance, or marker-broken spans', () => {
    const result = matchMediaHistoryAssets({
      assets: [asset('outside', 500), asset('too-far', 110_000), asset('gap', 75_000)],
      gpsSamples: [gps(1, 1_000), gps(2, 9_000), gps(3, 19_000), gps(4, 70_000), gps(5, 78_000)],
      markers: [marker(74_000, 'gap')],
      startAtMs: 1_000,
      endAtMs: 110_000,
    })
    expect(result).toEqual([])
  })

  test('matches media across real-world recording-backed GPS cadence', () => {
    const result = matchMediaHistoryAssets({
      assets: [asset('photo', 23_000)],
      gpsSamples: [gps(1, 12_000), gps(2, 37_000)],
      markers: [],
      startAtMs: 10_000,
      endAtMs: 40_000,
    })
    expect(result.map((item) => item.id)).toEqual(['photo'])
    expect(result[0].gps.capturedAtMs).toBe(12_000)
  })
})

test('clusters nearby assets in deterministic timestamp order', () => {
  const assets = [
    { ...asset('later', 2_000), gps: gps(1, 2_000) },
    { ...asset('first', 1_000), gps: gps(2, 1_000, 52.00001, 21.00001) },
    { ...asset('far', 3_000), gps: gps(3, 3_000, 53, 22) },
  ] satisfies MediaHistoryAsset[]
  const clusters = clusterMediaHistoryAssets(assets)
  expect(clusters.map((cluster) => cluster.assets.map((item) => item.id))).toEqual([
    ['first', 'later'],
    ['far'],
  ])
})

test('video telemetry rejects stale or gap-crossing samples', () => {
  const samples = [makeSample({ capturedAtMs: 1_000 }), makeSample({ capturedAtMs: 9_000 })]
  expect(findVideoTelemetrySample(samples, [], 1_000, 0)?.capturedAtMs).toBe(1_000)
  expect(findVideoTelemetrySample(samples, [marker(5_000, 'gap')], 1_000, 5)).toBeNull()
  expect(findVideoTelemetrySample(samples, [], 1_000, 20)).toBeNull()
  expect(
    findVideoTelemetrySample(
      [makeSample({ capturedAtMs: 1_000 }), makeSample({ capturedAtMs: 20_000 })],
      [],
      1_000,
      5,
    ),
  ).toBeNull()
})

describe('resolvePickedAssetCreationTime', () => {
  test('prefers EXIF DateTimeOriginal parsed as local time', () => {
    const result = resolvePickedAssetCreationTime({
      exif: { DateTimeOriginal: '2024:06:01 14:30:05' },
      filename: 'IMG_1234.jpg',
    })
    expect(result).toBe(new Date(2024, 5, 1, 14, 30, 5).getTime())
  })

  test('falls back to camera filename convention as local time', () => {
    const result = resolvePickedAssetCreationTime({
      filename: 'VID_20240601_143005.mp4',
    })
    expect(result).toBe(new Date(2024, 5, 1, 14, 30, 5).getTime())
  })

  test('parses Pixel PXL_ filenames as UTC', () => {
    const result = resolvePickedAssetCreationTime({
      filename: 'PXL_20240601_143005123.mp4',
    })
    expect(result).toBe(Date.UTC(2024, 5, 1, 14, 30, 5))
  })

  test('returns null when neither EXIF nor filename yields a date', () => {
    expect(resolvePickedAssetCreationTime({ filename: 'IMG_1234.MOV' })).toBeNull()
    expect(
      resolvePickedAssetCreationTime({ exif: { DateTimeOriginal: 42 }, filename: 'a.jpg' }),
    ).toBeNull()
  })
})
