import type { TelemetryMinuteBucket } from 'vescape-core'

/**
 * Minutes without a recorded sample that end a ride, when the rider has set no `rideSplitGapMinutes`.
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/ProfileStatsRepository.kt `DEFAULT_RIDE_SPLIT_GAP_MINUTES`
 * @parity /modules/vescape-core/ios/telemetry/ProfileStatsRepository.swift `DEFAULT_RIDE_SPLIT_GAP_MINUTES`
 */
export const DEFAULT_RIDE_SPLIT_GAP_MINUTES = 30
const SESSION_BREAK_BOUNDARIES = new Set(['disconnected', 'app_stop', 'error'])

/** Display breathing room kept on each side of the Moving Window so the stop/start transition stays visible. */
export const RIDE_TRIM_PADDING_MS = 5_000

export interface HistorySession {
  id: string
  deviceId: string | null
  deviceName: string
  startAtMs: number
  endAtMs: number
  /** First/last moving Telemetry Sample across the session — the Moving Window. Null on legacy data. */
  movingStartAtMs: number | null
  movingEndAtMs: number | null
  blockIds: string[]
  blockCount: number
  sampleCount: number
  gpsPointCount: number
  preciseGpsPointCount: number
  distanceM: number | null
  maxSpeedKmh: number
  avgSpeedKmh: number
  maxTempMosfet: number | null
  maxTempMotor: number | null
  maxDuty: number
  batteryUsedWh: number
  batteryRegenWh: number
  firstLatitude: number | null
  firstLongitude: number | null
  centerLatitude: number | null
  centerLongitude: number | null
  minLatitude: number | null
  maxLatitude: number | null
  minLongitude: number | null
  maxLongitude: number | null
  faultCount: number
  boundaryBefore: TelemetryMinuteBucket['boundaryBefore']
}

interface MutableSessionAggregate {
  deviceId: string | null
  deviceName: string
  boundaryBefore: TelemetryMinuteBucket['boundaryBefore']
  startAtMs: number
  endAtMs: number
  movingStartAtMs: number | null
  movingEndAtMs: number | null
  blockIds: string[]
  blockCount: number
  sampleCount: number
  gpsPointCount: number
  preciseGpsPointCount: number
  distanceDeltaSum: number
  gpsDistanceSum: number
  distanceDeltaCount: number
  gpsDistanceCount: number
  maxSpeedKmh: number
  avgSpeedSum: number
  avgSpeedSampleCount: number
  maxTempMosfet: number | null
  maxTempMotor: number | null
  maxDuty: number
  batteryUsedWh: number
  batteryRegenWh: number
  firstLatitude: number | null
  firstLongitude: number | null
  latitudeSum: number
  longitudeSum: number
  coordinateCount: number
  minLatitude: number | null
  maxLatitude: number | null
  minLongitude: number | null
  maxLongitude: number | null
  faultCount: number
}

export function groupHistorySessions(
  blocks: TelemetryMinuteBucket[],
  options?: { gapMs?: number },
): HistorySession[] {
  if (!blocks.length) return []
  const gapMs = options?.gapMs ?? DEFAULT_RIDE_SPLIT_GAP_MINUTES * 60_000
  const oldestFirst = [...blocks].reverse()
  const sessions: MutableSessionAggregate[] = []
  let current: MutableSessionAggregate | null = null
  let previousBlock: TelemetryMinuteBucket | null = null

  for (const block of oldestFirst) {
    const breakByDevice = !current || current.deviceId !== block.deviceId
    const breakByGap = !!previousBlock && block.startAtMs - previousBlock.endAtMs > gapMs
    const breakByBoundary = SESSION_BREAK_BOUNDARIES.has(block.boundaryBefore)

    if (!current || breakByDevice || breakByGap || breakByBoundary) {
      if (current) sessions.push(current)
      current = createAggregate(block)
    } else {
      mergeBlockIntoAggregate(current, block)
    }

    previousBlock = block
  }

  if (current) sessions.push(current)

  return sessions
    .filter((session) => session.avgSpeedSampleCount > 0)
    .map(finalizeSession)
    .sort((a, b) => b.startAtMs - a.startAtMs)
}

/** The ride carrying this recording id, or null when the loaded pages do not hold it yet. */
export function findSessionById(sessions: HistorySession[], rideId: string): HistorySession | null {
  return sessions.find((session) => session.id === rideId) ?? null
}

/**
 * The Moving Window of a ride: first→last moving sample. Null when no moving samples were
 * recorded (legacy data with no precomputed window, or a non-ride that was filtered out).
 */
export function rideMovingWindow(
  session: Pick<HistorySession, 'movingStartAtMs' | 'movingEndAtMs'>,
): { startMs: number; endMs: number } | null {
  if (session.movingStartAtMs == null || session.movingEndAtMs == null) return null
  return { startMs: session.movingStartAtMs, endMs: session.movingEndAtMs }
}

/** Riding span shown as ride Time: Moving Window duration, or full wall-clock span on legacy data. */
export function rideDurationMs(
  session: Pick<HistorySession, 'movingStartAtMs' | 'movingEndAtMs' | 'startAtMs' | 'endAtMs'>,
): number {
  const window = rideMovingWindow(session)
  if (window) return window.endMs - window.startMs
  return session.endAtMs - session.startAtMs
}

function createAggregate(block: TelemetryMinuteBucket): MutableSessionAggregate {
  const aggregate: MutableSessionAggregate = {
    deviceId: block.deviceId,
    deviceName: block.deviceName,
    boundaryBefore: block.boundaryBefore,
    startAtMs: block.startAtMs,
    endAtMs: block.endAtMs,
    movingStartAtMs: null,
    movingEndAtMs: null,
    blockIds: [],
    blockCount: 0,
    sampleCount: 0,
    gpsPointCount: 0,
    preciseGpsPointCount: 0,
    distanceDeltaSum: 0,
    gpsDistanceSum: 0,
    distanceDeltaCount: 0,
    gpsDistanceCount: 0,
    maxSpeedKmh: 0,
    avgSpeedSum: 0,
    avgSpeedSampleCount: 0,
    maxTempMosfet: null,
    maxTempMotor: null,
    maxDuty: 0,
    batteryUsedWh: 0,
    batteryRegenWh: 0,
    firstLatitude: null,
    firstLongitude: null,
    latitudeSum: 0,
    longitudeSum: 0,
    coordinateCount: 0,
    minLatitude: null,
    maxLatitude: null,
    minLongitude: null,
    maxLongitude: null,
    faultCount: 0,
  }
  mergeBlockIntoAggregate(aggregate, block)
  return aggregate
}

function mergeBlockIntoAggregate(
  session: MutableSessionAggregate,
  block: TelemetryMinuteBucket,
): void {
  session.startAtMs = Math.min(session.startAtMs, block.startAtMs)
  session.endAtMs = Math.max(session.endAtMs, block.endAtMs)
  if (block.firstMovingAtMs != null) {
    session.movingStartAtMs =
      session.movingStartAtMs == null
        ? block.firstMovingAtMs
        : Math.min(session.movingStartAtMs, block.firstMovingAtMs)
  }
  if (block.lastMovingAtMs != null) {
    session.movingEndAtMs =
      session.movingEndAtMs == null
        ? block.lastMovingAtMs
        : Math.max(session.movingEndAtMs, block.lastMovingAtMs)
  }
  session.blockIds.push(block.id)
  session.blockCount += 1
  session.sampleCount += block.sampleCount
  session.gpsPointCount += block.gpsPointCount
  session.preciseGpsPointCount += block.preciseGpsPointCount
  session.faultCount += block.faultCount

  if (block.distanceDeltaM != null) {
    session.distanceDeltaSum += block.distanceDeltaM
    session.distanceDeltaCount += 1
  }
  if (block.gpsDistanceM != null) {
    session.gpsDistanceSum += block.gpsDistanceM
    session.gpsDistanceCount += 1
  }

  session.maxSpeedKmh = Math.max(session.maxSpeedKmh, block.maxAbsSpeedKmh)
  if (block.avgSpeedSampleCount > 0) {
    session.avgSpeedSum += block.avgSpeedKmh * block.avgSpeedSampleCount
    session.avgSpeedSampleCount += block.avgSpeedSampleCount
  }

  if (block.maxTempMosfet != null) {
    session.maxTempMosfet =
      session.maxTempMosfet != null
        ? Math.max(session.maxTempMosfet, block.maxTempMosfet)
        : block.maxTempMosfet
  }
  if (block.maxTempMotor != null) {
    session.maxTempMotor =
      session.maxTempMotor != null
        ? Math.max(session.maxTempMotor, block.maxTempMotor)
        : block.maxTempMotor
  }
  session.maxDuty = Math.max(session.maxDuty, block.maxDuty)
  session.batteryUsedWh += block.batteryUsedWh ?? 0
  session.batteryRegenWh += block.batteryRegenWh ?? 0

  if (session.firstLatitude == null && block.firstLatitude != null) {
    session.firstLatitude = block.firstLatitude
    session.firstLongitude = block.firstLongitude
  }
  if (block.firstLatitude != null && block.firstLongitude != null) {
    addCoordinate(session, block.firstLatitude, block.firstLongitude)
  }
}

function addCoordinate(
  session: MutableSessionAggregate,
  latitude: number,
  longitude: number,
): void {
  session.latitudeSum += latitude
  session.longitudeSum += longitude
  session.coordinateCount += 1
  session.minLatitude =
    session.minLatitude == null ? latitude : Math.min(session.minLatitude, latitude)
  session.maxLatitude =
    session.maxLatitude == null ? latitude : Math.max(session.maxLatitude, latitude)
  session.minLongitude =
    session.minLongitude == null ? longitude : Math.min(session.minLongitude, longitude)
  session.maxLongitude =
    session.maxLongitude == null ? longitude : Math.max(session.maxLongitude, longitude)
}

function finalizeSession(session: MutableSessionAggregate): HistorySession {
  const distanceM =
    session.distanceDeltaCount > 0
      ? session.distanceDeltaSum
      : session.gpsDistanceCount > 0
        ? session.gpsDistanceSum
        : null
  const avgSpeedKmh =
    session.avgSpeedSampleCount > 0 ? session.avgSpeedSum / session.avgSpeedSampleCount : 0
  const centerLatitude =
    session.coordinateCount > 0 ? session.latitudeSum / session.coordinateCount : null
  const centerLongitude =
    session.coordinateCount > 0 ? session.longitudeSum / session.coordinateCount : null

  return {
    id: `${session.deviceId ?? 'unknown'}:${session.startAtMs}:${session.endAtMs}`,
    deviceId: session.deviceId,
    deviceName: session.deviceName,
    startAtMs: session.startAtMs,
    endAtMs: session.endAtMs,
    movingStartAtMs: session.movingStartAtMs,
    movingEndAtMs: session.movingEndAtMs,
    blockIds: session.blockIds,
    blockCount: session.blockCount,
    sampleCount: session.sampleCount,
    gpsPointCount: session.gpsPointCount,
    preciseGpsPointCount: session.preciseGpsPointCount,
    distanceM,
    maxSpeedKmh: session.maxSpeedKmh,
    avgSpeedKmh,
    maxTempMosfet: session.maxTempMosfet,
    maxTempMotor: session.maxTempMotor,
    maxDuty: session.maxDuty,
    batteryUsedWh: session.batteryUsedWh,
    batteryRegenWh: session.batteryRegenWh,
    firstLatitude: session.firstLatitude,
    firstLongitude: session.firstLongitude,
    centerLatitude,
    centerLongitude,
    minLatitude: session.minLatitude,
    maxLatitude: session.maxLatitude,
    minLongitude: session.minLongitude,
    maxLongitude: session.maxLongitude,
    faultCount: session.faultCount,
    boundaryBefore: session.boundaryBefore,
  }
}
