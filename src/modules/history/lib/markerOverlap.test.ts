import { describe, expect, test } from 'bun:test'
import { resolveMarkerRenderData } from '@/modules/history/lib/markerOverlap'
import type { HistoryGpsSample, HistoryMarker } from 'vescape-core'

function makeGps(id: number, capturedAtMs: number, lat: number, lng: number): HistoryGpsSample {
  return {
    id,
    capturedAtMs,
    boardId: null,
    boardName: 'test',
    latitude: lat,
    longitude: lng,
    speedMps: null,
    bearingDeg: null,
    accuracyM: null,
    altitudeM: null,
    timestamp: capturedAtMs,
    distanceFromPreviousM: null,
  }
}

function makeMarker(id: number, occurredAtMs: number, type: HistoryMarker['type']): HistoryMarker {
  return { id, occurredAtMs, type, boardId: null, message: null, gapMs: null }
}

describe('resolveMarkerRenderData', () => {
  test('single marker at GPS sample renders at true coordinate', () => {
    const gps = [makeGps(1, 1000, 50.0, 14.0)]
    const markers = [makeMarker(1, 1000, 'connected')]
    const result = resolveMarkerRenderData(markers, gps)

    expect(result).toHaveLength(1)
    expect(result[0].renderCoordinate).toEqual([14.0, 50.0])
    expect(result[0].gps).toBe(gps[0])
    expect(result[0].marker).toBe(markers[0])
  })

  test('two markers at same GPS sample get offset coordinates', () => {
    const gps = [makeGps(1, 1000, 50.0, 14.0)]
    const markers = [makeMarker(1, 1000, 'connected'), makeMarker(2, 1001, 'disconnected')]
    const result = resolveMarkerRenderData(markers, gps)

    expect(result).toHaveLength(2)

    for (const r of result) {
      expect(r.gps).toBe(gps[0])
      const moved =
        Math.abs(r.renderCoordinate[0] - 14.0) > 1e-8 ||
        Math.abs(r.renderCoordinate[1] - 50.0) > 1e-8
      expect(moved).toBe(true)
    }

    expect(result[0].renderCoordinate).not.toEqual(result[1].renderCoordinate)
  })

  test('offsets are small enough to stay near true point', () => {
    const gps = [makeGps(1, 1000, 50.0, 14.0)]
    const markers = [
      makeMarker(1, 999, 'connected'),
      makeMarker(2, 1000, 'gap'),
      makeMarker(3, 1001, 'disconnected'),
    ]
    const result = resolveMarkerRenderData(markers, gps)

    for (const r of result) {
      const dlat = Math.abs(r.renderCoordinate[1] - 50.0)
      const dlng = Math.abs(r.renderCoordinate[0] - 14.0)
      expect(dlat).toBeLessThan(0.0001)
      expect(dlng).toBeLessThan(0.0001)
    }
  })

  test('markers at different GPS samples not offset', () => {
    const gps = [makeGps(1, 1000, 50.0, 14.0), makeGps(2, 5000, 51.0, 15.0)]
    const markers = [makeMarker(1, 1000, 'connected'), makeMarker(2, 5000, 'disconnected')]
    const result = resolveMarkerRenderData(markers, gps)

    expect(result).toHaveLength(2)
    expect(result[0].renderCoordinate).toEqual([14.0, 50.0])
    expect(result[1].renderCoordinate).toEqual([15.0, 51.0])
  })

  test('marker with no matching GPS sample excluded', () => {
    const result = resolveMarkerRenderData([makeMarker(1, 1000, 'error')], [])
    expect(result).toHaveLength(0)
  })

  test('offsets are deterministic', () => {
    const gps = [makeGps(1, 1000, 50.0, 14.0)]
    const markers = [makeMarker(1, 1000, 'connected'), makeMarker(2, 1001, 'gap')]
    const a = resolveMarkerRenderData(markers, gps)
    const b = resolveMarkerRenderData(markers, gps)

    expect(a[0].renderCoordinate).toEqual(b[0].renderCoordinate)
    expect(a[1].renderCoordinate).toEqual(b[1].renderCoordinate)
  })
})
