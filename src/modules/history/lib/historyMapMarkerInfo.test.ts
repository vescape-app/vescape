import { expect, test } from 'bun:test'

test('legacy marker accuracy keeps fixed feet, missing accuracy stays absent', () => {
  // Isolate icon mocks from other files in Bun's shared test process.
  const script = `
    import { expect, mock } from 'bun:test'
    mock.module('phosphor-react-native', () => ({
      ClockCountdownIcon: () => null, LinkBreakIcon: () => null, PauseIcon: () => null,
      PlugsConnectedIcon: () => null, StopIcon: () => null, WarningCircleIcon: () => null,
    }))
    const { buildHistoryMarkerMessage } = await import('./src/modules/history/lib/historyMapMarkerInfo')
  const selection = {
    marker: { id: 1, occurredAtMs: 1000, type: 'gap', boardId: null, message: null, gapMs: 5000 },
    gps: {
      id: 1, recordingId: null, capturedAtMs: 1000, boardId: null, boardName: '',
      latitude: 52, longitude: 21, speedMps: null, bearingDeg: null, accuracyM: 1000,
      altitudeM: null, timestamp: 1000, distanceFromPreviousM: null,
    },
  }
  expect(buildHistoryMarkerMessage(selection, 'imperial')).toContain('GPS accuracy: 3280.8 ft')
  expect(buildHistoryMarkerMessage(selection, 'metric')).toContain('GPS accuracy: 1000.0 m')
  expect(selection.gps.accuracyM).toBe(1000)
  expect(buildHistoryMarkerMessage({ ...selection, gps: { ...selection.gps, accuracyM: null } }, 'imperial')).not.toContain('GPS accuracy:')
  `
  const result = Bun.spawnSync(
    [process.execPath, '--preload', './testSetup.ts', '--eval', script],
    {
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  expect(result.stderr.toString()).toBe('')
  expect(result.exitCode).toBe(0)
})
