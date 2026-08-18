/**
 * TS declaration of the VescapeCore native contract: every type here mirrors a native definition.
 * Coverage is not uniform — parts of this surface are Android-only (Group Ride, Remote Tilt) and
 * some shared states are platform-specific. Those gaps are marked in place below with
 * `@platform-diff` or `TODO(iOS parity)`; the file-level tags point at the two module entry points.
 *
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt
 *
 * Narrower `@parity` tags below mark the nodes that drift silently: columnar buffer layouts and
 * enums native re-declares.
 */

import { requireNativeModule, type EventSubscription } from 'expo-modules-core'

import { e2eFake } from './e2eFake'

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

export interface DeviceFoundEvent {
  id: string
  name: string
  rssi: number
  serviceUUIDs: string[]
}

export interface ErrorEvent {
  message: string
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescTelemetryModels.kt `LocationSnapshot`
 * @parity /modules/vescape-core/ios/telemetry/TelemetryPipeline.swift `TelemetryLocationCapture`
 */
export interface LocationEvent {
  latitude: number
  longitude: number
  speedMps: number | null
  /** The fix's own bearing, straight off the receiver — noisy at a standstill. */
  bearingDeg: number | null
  /**
   * The direction the rider is actually travelling, derived natively per precise fix and retained
   * briefly across stops. Null on approximate fixes and while no course is trustworthy.
   */
  courseDeg: number | null
  /** The fix `courseDeg` came from; older than `timestamp` while a course is retained. */
  courseSourceTimestamp: number | null
  accuracyM: number | null
  altitudeM: number | null
  timestamp: number
  precise: boolean
}

/**
 * @parity /modules/vescape-core/ios/connection/BoardPhase.swift `BoardPhase`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardPhase.kt `BoardPhase`
 * @platform-diff `stale` and `disconnecting` are Android-only. iOS routes stale telemetry through
 * `reconnecting` and stops straight to `idle`/`error`, so JS must treat both as optional.
 */
export type SessionStatus =
  | 'idle'
  | 'connecting'
  | 'discovering'
  | 'subscribing'
  | 'waiting_for_telemetry'
  | 'connected'
  | 'stale'
  | 'reconnecting'
  | 'rescanning'
  | 'disconnecting'
  | 'error'
export type BoardStatus = SessionStatus
export type GpsStatus = 'idle' | 'active'
export type ScanStatus = 'idle' | 'scanning' | 'error'

export interface FiredAlert {
  ruleId: string
  controlId: string
  value: number
  threshold: number
  thresholdMax: number | null
  soundType: string
  /** 0..1 depth into the threshold→thresholdMax range for geiger alerts; `null` for single. */
  rangeDepth?: number | null
  firedAt: number
}

/**
 * How a Board is reached. `null` = undetected (no persisted "unknown" state),
 * `'direct'` = direct connection, a number = CAN-forwarded to that CAN id.
 */
export type BoardTransport = 'direct' | number

export type BoardProbeOutcome = 'resolved' | 'needs-pick' | 'none'

/** A probe-confirmed transport plus the capabilities discovered while probing it. */
export interface BoardCandidate {
  transport: BoardTransport
  /** Whether a smart-BMS answered on this transport during the probe. */
  hasBms: boolean
  vescFirmwareVersion?: string | null
  refloatVersion?: string | null
  refloatBaseVersion?: string | null
}

/** Result of a native Board Probe of a BLE peripheral. */
export interface BoardProbeResult {
  outcome: BoardProbeOutcome
  /** Resolved transport when exactly one candidate confirmed; otherwise `null`. */
  transport: BoardTransport | null
  /** Every transport that produced a valid Telemetry Sample, in probe order. */
  candidates: BoardCandidate[]
}

/**
 * Live probe milestone, named for what the probe is doing right now:
 * `connecting` → `handshake` (service discovery) → `pinging` (CAN scan) → per
 * candidate transport `probing` (waiting for telemetry proof) → `bms` (transport
 * confirmed, waiting for a BMS answer) → `identity` (BMS answered, waiting for
 * the Refloat info reply). Steps whose reply never comes are skipped — the probe
 * window closing resolves them. With several responding CAN ids the sequence
 * revisits `probing` for the next candidate. Final facts are still read from the
 * returned {@link BoardCandidate}s; detail stays in Diagnostic Events.
 */
/**
 * @parity /modules/vescape-core/ios/connection/BoardTransportDetector.swift `emitProgress`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardTransportDetector.kt `emitProgress`
 */
export type BoardProbeStep =
  | 'connecting'
  | 'handshake'
  | 'pinging'
  | 'probing'
  | 'bms'
  | 'identity'
  | 'completed'
  | 'failed'

export interface BoardProbeProgressEvent {
  /** Native probe operation id. Used to ignore stale progress from cancelled probes. */
  probeId?: string
  step: BoardProbeStep
  /** Milliseconds elapsed since the probe started. */
  elapsedMs: number
  /** Candidate transport the milestone is about; absent before `probing`. */
  transport?: BoardTransport
  /** CAN ids that answered the CAN scan; absent before `probing`. */
  canIds?: number[]
}

/**
 * @parity /modules/vescape-core/ios/runtime/BoardSession.swift `LinkIntegrity`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/runtime/BoardSession.kt `LinkIntegrity`
 */
export type LinkIntegrity = 'unknown' | 'checking' | 'trusted' | 'outdated' | 'mismatched'

/**
 * Durable, probe-confirmed reachability for a Board. Saved whole or not at all:
 * a Board Link always carries a proven BLE peripheral id and Board Transport.
 */
export interface BoardLink {
  /** Durable Board Link schema version. Missing/lower versions are normalized as legacy links. */
  linkVersion?: 3
  bleId: string
  transport: BoardTransport
  /**
   * Probe-confirmed smart-BMS presence on {@link transport}. `undefined` on links
   * saved before BMS detection existed — treated as unknown (still polled).
   */
  hasBms?: boolean
  vescFirmwareVersion?: string
  refloatVersion?: string
  refloatBaseVersion?: string
}

export interface Board {
  id: string
  name: string
  description: string | null
  createdAt: number
  batteryConfig: BatteryConfig | null
  /** Last Battery SoC Estimate persisted natively; survives full app kill. `undefined` before first session. */
  lastBattery?: LastBattery | null
  /**
   * Board Warning kinds the rider dismissed (acknowledged). Dismissed warnings stay in the native
   * registry and render grayed in the warnings sheet, but stop counting toward the board's warning
   * indicator. Absent/empty means nothing dismissed.
   * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `normalizeDismissedWarnings`
   * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `normalizeDismissedWarnings`
   */
  dismissedWarnings?: string[]
  /**
   * Board Top Speed in km/h (renamed from the former profile-level Rider Top Speed): the rider's
   * self-assessed max on this Board. Drives the speed gauge full-scale and the km/h thresholds a
   * speed Alert Preset resolves to. Not a legal or firmware limit. Absent ⇒ display default 50.
   */
  topSpeedKmh?: number
  /**
   * Durable per-metric Alert Preset level selection for this Board. JS owns behavior; native only
   * persists this bag. Absent ⇒ all metrics Off (no preset rules until the rider touches setup).
   */
  alertPreset?: Record<string, unknown> | null
  /**
   * One-time gate for the guided Alert Preset step in the add-board wizard, per Board. False until
   * the rider completes that step for this Board. The durable setup home is the Alerts settings
   * entry regardless of this flag.
   */
  alertPresetsOnboarded?: boolean
  /**
   * Durable per-Board Legal Mode activation. Native owns behavior and persists this setting;
   * JS reads it and sends the dedicated activation intent. Absent ⇒ disabled.
   * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `composeBoard`
   * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `toMap`
   */
  legalMode?: { enabled: boolean }
  /** Probe-confirmed reachability. `null` means offline-only/unlinked. */
  link: BoardLink | null
}

export interface LastBattery {
  percent: number
  voltage: number | null
  /** Epoch ms of the reading. */
  at: number
}

export type BatteryConfig = BatteryPresetConfig | BatteryManualConfig

export interface BatteryPresetConfig {
  mode: 'preset'
  cellPresetId: string
  seriesCount: number
  parallelCount: number
}

export interface BatteryManualConfig {
  mode: 'manual'
  minVoltage: number
  maxVoltage: number
}

export type AlertSoundType = string

/**
 * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `alertCategorySingle`, `alertCategoryGeiger`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `ALERT_CATEGORY_SINGLE`, `ALERT_CATEGORY_GEIGER`
 */
export type AlertSoundCategory = 'single' | 'geiger'

export interface AlertSound {
  name: string
  uri: string
  category: AlertSoundCategory
}

/**
 * Ephemeral rule snapshot for the isolated UI alert test. It deliberately omits Board ownership
 * and persistence fields: native evaluates it in a test-only coordinator and never stores it.
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `alertTestRule`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `toAlertTestRule`
 */
export interface AlertTestRule {
  id: string
  controlId: string
  threshold: number
  thresholdMax: number | null
  soundType: AlertSoundType
  /** Carried so a test sounds like the real rule: same cadence, same number of beeps. */
  repeatEverySeconds: number | null
  beepCount: number
}

// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt `AlertRuleEntity`
// @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `AlertRule`
export interface AlertRule {
  /** Owning Board. The alert engine evaluates only the connected Board's rules (see docs/alerts.md). */
  boardId: string
  id: string
  controlId: string
  threshold: number
  thresholdMax: number | null
  enabled: boolean
  soundType: AlertSoundType
  createdAt: number
  /**
   * Repeat cadence for a single-threshold rule, in seconds. `null` ⇒ one-shot: it announces once
   * per crossing and stays silent until the metric re-arms it. Ignored for range (geiger) rules,
   * whose cadence follows range depth. Native clamps to {@link ALERT_REPEAT_MIN_SECONDS}.
   */
  repeatEverySeconds: number | null
  /**
   * How many times the sound plays per announcement, {@link ALERT_BEEP_COUNT_RANGE}. Applies to
   * preset sounds only — a text-to-speech rule speaks once regardless.
   */
  beepCount: number
  /**
   * Provenance tag. `manual` (or absent) = rider-authored. `preset` rules are generated + owned
   * by JS orchestration and regenerated wholesale; native persists the string opaquely.
   */
  source?: 'manual' | 'preset'
}

/**
 * Floor on {@link AlertRule.repeatEverySeconds}. Native clamps to it, so no rule written by any
 * path — rider, preset, or import — can announce fast enough to become noise.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `ALERT_REPEAT_MIN_SECONDS`
 * @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `alertRepeatMinSeconds`
 */
export const ALERT_REPEAT_MIN_SECONDS = 3

/**
 * Inclusive bounds on {@link AlertRule.beepCount}. Past 5 the beeps stop being countable by ear
 * at riding speed, which is the only thing the count is for.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `ALERT_BEEP_COUNT_RANGE`
 * @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `alertBeepCountRange`
 */
export const ALERT_BEEP_COUNT_RANGE = { min: 1, max: 5 } as const

/** Beeps per announcement when nothing says otherwise — matches the pre-`beepCount` behavior. */
export const ALERT_BEEP_COUNT_DEFAULT = 3

export type PrivacyZonePreset = 'home' | 'work' | 'custom'

export interface PrivacyZone {
  id: string
  preset: PrivacyZonePreset
  name: string
  enabled: boolean
  centerLatitude: number
  centerLongitude: number
  radiusMeters: number
  createdAt: number
  updatedAt: number
}

/**
 * Map Point categories the server accepts. `direction` is not one of them: a direction target is
 * personal client state, never a shared place.
 *
 * @parity /modules/vescape-core/ios/mappoints/MapPointApi.swift
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/mappoints/MapPointApi.kt
 * @parity /Users/kacper/Workspace/vescape-server/src/mapPoints/protocol.ts `MapPointCategorySchema`
 */
export type MapPointCategory =
  | 'drop'
  | 'bonk'
  | 'nose_slide'
  | 'trail_entry'
  | 'viewpoint'
  | 'charging'

export type MapPointReaction = 'up' | 'down'

/**
 * One server-owned Map Point as the nearby read returns it. `score`, `myReaction` and `ownedByMe`
 * are resolved by the server for the calling Account; the app derives none of them.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/mappoints/MapPointApi.kt `mapPoint`
 * @parity /modules/vescape-core/ios/mappoints/MapPointApi.swift `mapPoint`
 */
export interface MapPoint {
  id: string
  category: MapPointCategory
  latitude: number
  longitude: number
  name: string | null
  description: string | null
  score: number
  myReaction: MapPointReaction | null
  ownedByMe: boolean
  distanceMeters: number
  /** ISO-8601, server clock. */
  createdAt: string
  updatedAt: string
}

export interface NearbyMapPoints {
  items: MapPoint[]
  /** More Map Points match than the server returned. Version one has no pagination. */
  truncated: boolean
}

/** Values a Map Point is created with. Category and coordinates are required. */
export interface MapPointValues {
  category: MapPointCategory
  latitude: number
  longitude: number
  name?: string | null
  description?: string | null
}

/** Editable fields; an absent key is left alone, an explicit `null` clears the field. */
export type MapPointPatch = Partial<MapPointValues>

/**
 * Codes a failed Map Point call rejects with, so JS can tell "sign in" from "you are offline".
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/mappoints/MapPointApi.kt `MapPointApiException`
 * @parity /modules/vescape-core/ios/mappoints/MapPointApi.swift `MapPointApiError`
 */
export type MapPointErrorCode =
  | 'MAP_POINT_SIGN_IN_REQUIRED'
  | 'MAP_POINT_NOT_YOURS'
  | 'MAP_POINT_GONE'
  | 'MAP_POINT_REFUSED'
  | 'MAP_POINT_UNREACHABLE'

export interface TelemetryEvent {
  generation?: number
  /** Native remote-tilt snapshot paired with this telemetry tick. */
  remoteTilt?: RemoteTiltState | null
  location?: LocationEvent | null
  metricExclusions?: Record<string, boolean>
  metricExclusionUpdates?: LiveMetricExclusionUpdate[]
  hasFault: boolean
  faultCode: number
  pitch: number
  roll: number
  balancePitch: number
  balanceCurrent: number
  speed: number
  batteryVoltage: number
  batteryPercent: number | null
  motorCurrent: number
  batteryCurrent: number
  erpm: number
  dutyCycle: number
  state: number
  stateName: string
  switchState: number
  adc1: number
  adc2: number
  odometer: number | null
  tempMosfet: number | null
  tempMotor: number | null
  avgLatency: number | null
  /** Achieved telemetry pull rate in Hz (native-measured, smoothed), or null before it's known. */
  pullRateHz: number | null
  lastPacketAt: number
  firedAlerts?: FiredAlert[]
}

/** Smart-BMS snapshot decoded from a VESC `COMM_BMS_GET_VALUES` reply. */
export interface BmsEvent {
  capturedAt: number
  /** Pack voltage as reported by the BMS (sum of cell groups). */
  voltageTotal: number
  /** Charge-port voltage (`v_charge`); meaning is firmware/BMS-specific. */
  vCharge: number
  /** Pack current from the BMS shunt. */
  current: number
  /** Second/internal current field (`i_in_ic`); compare against `current`. */
  currentIc: number
  ampHours: number
  wattHours: number
  /** State of charge 0–1, or null when the firmware variant omits it. */
  soc: number | null
  /** State of health 0–1, or null when the firmware variant omits it. */
  soh: number | null
  /** Per cell-group voltage, index 0 = first group. */
  cellVoltages: number[]
  /** Per cell-group balancing flag, aligned with cellVoltages. */
  balancing: boolean[]
  /** Per-sensor BMS temperatures in °C (`temps_adc`); empty when firmware omits them. */
  temps: number[]
  /** BMS IC temperature °C, or null when absent. */
  tempIc: number | null
  /** Humidity-sensor temperature °C, or null when absent. */
  tempHum: number | null
  /** Relative humidity %, or null when absent. */
  hum: number | null
  /** Hottest cell temperature °C, or null when absent. */
  tempMaxCell: number | null
  /** BMS CAN id, or null when absent. */
  canId: number | null
}

export interface BmsSeriesFrame {
  capturedAt: number
  cellVoltages: number[]
  balancing: boolean[]
}

export interface BmsSeriesUpdate {
  mode: 'snapshot' | 'append'
  generation: number
  windowMs: number
  frames: BmsSeriesFrame[]
}

export interface LiveMetricExclusionUpdate {
  lastPacketAt: number
  metricExclusions: Record<string, boolean>
}

export type BoardPhase = SessionStatus
export type GpsPhase = 'idle' | 'starting' | 'active' | 'error'
export type ScanPhase = ScanStatus
/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RemoteTiltController.kt `RemoteTiltPhase`
 * TODO(iOS parity): no iOS peer — Remote Tilt is not ported yet.
 */
export type RemoteTiltPhase = 'idle' | 'holding' | 'decaying' | 'locked'

export interface RemoteTiltDecay {
  elapsedMs: number
  totalMs: number
}

/** Native-owned active remote-tilt command. `null` represents idle. */
export interface RemoteTiltState {
  value: number
  phase: Exclude<RemoteTiltPhase, 'idle'>
  /** Present only while native is executing a release decay. */
  decay?: RemoteTiltDecay
}

export interface LiveStateEvent {
  board: {
    phase: BoardPhase
    selectedBoardId: string | null
    connectedBoardId: string | null
    bleId: string | null
    name: string | null
    connectionSeq: number
    lastTelemetryAt: number | null
    recentTelemetry: TelemetryEvent[]
    error: string | null
    autoConnect: boolean
    linkIntegrity: LinkIntegrity
    /** Native-owned active remote-tilt command, or `null` when idle. */
    remoteTilt: RemoteTiltState | null
  }
  gps: {
    phase: GpsPhase
    latestFix: LocationEvent | null
    latestApproximateFix?: LocationEvent | null
    latestPreciseFix?: LocationEvent | null
    recentLocations: LocationEvent[]
    error: string | null
  }
  scan: {
    phase: ScanPhase
    devices: DeviceFoundEvent[]
    error: string | null
  }
  recording: {
    enabled: boolean
    paused: boolean
    activeBoardId: string | null
    startedAt: number | null
  }
}

export interface TelemetryHistoryOptions {
  fromMs?: number
  toMs?: number
  deviceId?: string
  limit?: number
  cursorBeforeMs?: number
}

export interface DiagnosticEventOptions {
  fromMs?: number
  toMs?: number
  deviceId?: string
  limit?: number
}

export interface TelemetryDeleteRangeOptions {
  fromMs: number
  toMs: number
  deviceId?: string | null
}

export interface TelemetryMinuteBucket {
  id: string
  startAtMs: number
  endAtMs: number
  bucketStartMs: number
  deviceId: string | null
  deviceName: string
  sampleCount: number
  gpsPointCount: number
  preciseGpsPointCount: number
  maxAbsSpeedKmh: number
  maxGpsSpeedKmh: number | null
  avgSpeedKmh: number
  avgSpeedSampleCount: number
  minBatteryVoltage: number | null
  maxMotorCurrent: number
  maxBatteryCurrent: number
  maxDuty: number
  faultCount: number
  distanceDeltaM: number | null
  gpsDistanceM: number | null
  maxTempMosfet: number | null
  maxTempMotor: number | null
  batteryUsedWh: number
  batteryRegenWh: number
  firstLatitude: number | null
  firstLongitude: number | null
  firstMovingAtMs: number | null
  lastMovingAtMs: number | null
  boundaryBefore:
    | 'none'
    | 'connected'
    | 'disconnected'
    | 'connection_lost'
    | 'error'
    | 'gap'
    | 'app_stop'
  boundaryMessage?: string | null
  gapBeforeMs?: number | null
}

export interface TelemetrySample {
  id: number
  capturedAtMs: number
  deviceId: string | null
  deviceName: string
  speedKmh: number
  batteryVoltage: number
  /** IR-compensated battery %, derived on read from the board's battery config. Null if no config. */
  batteryPercent: number | null
  motorCurrent: number
  batteryCurrent: number
  dutyCycle: number
  pitch: number
  roll: number
  balancePitch: number
  balanceCurrent: number
  erpm: number
  state: number
  switchState: number
  adc1: number
  adc2: number
  odometer: number | null
  tempMosfet: number | null
  tempMotor: number | null
  hasFault: boolean
  faultCode: number
  latitude: number | null
  longitude: number | null
}

export interface HistoryGpsSample {
  id: number
  capturedAtMs: number
  deviceId: string | null
  deviceName: string
  latitude: number
  longitude: number
  speedMps: number | null
  bearingDeg: number | null
  accuracyM: number | null
  altitudeM: number | null
  timestamp: number
  precise: boolean
  distanceFromPreviousM: number | null
}

export interface HistoryMarker {
  id: number
  occurredAtMs: number
  type:
    | 'connected'
    | 'disconnected'
    | 'connection_lost'
    | 'error'
    | 'gap'
    | 'app_stop'
    | 'auto_pause'
  deviceId: string | null
  deviceName: string | null
  message: string | null
  gapMs: number | null
}

export interface MetricExclusion {
  id: number
  deviceId: string | null
  reason: string
  startMs: number
  endMs: number
  sampleCount: number
  metrics: Record<string, boolean>
}

export interface HistoryRange {
  boardSamples: TelemetrySample[]
  /** Native-decimated overview used by the compact ride chart. */
  chartSamples: TelemetrySample[]
  gpsSamples: HistoryGpsSample[]
  markers: HistoryMarker[]
  exclusions: MetricExclusion[]
}

/**
 * Float64 lanes per sample in the columnar board payload. Must match the native encoder.
 *
 * @parity /modules/vescape-core/ios/telemetry/TelemetryRepository.swift `SAMPLE_COLUMN_COUNT`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `SAMPLE_COLUMN_COUNT`
 */
const SAMPLE_COLUMN_COUNT = 25

/**
 * @parity /modules/vescape-core/ios/telemetry/BmsSeriesRing.swift `BMS_SERIES_FIXED_LANES`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/BmsSeriesRing.kt `BMS_SERIES_FIXED_LANES`
 */
const BMS_SERIES_FIXED_LANES = 3

/**
 * @parity /modules/vescape-core/ios/telemetry/BmsSeriesRing.swift `BMS_SERIES_BALANCE_LANE_BITS`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/BmsSeriesRing.kt `BMS_SERIES_BALANCE_LANE_BITS`
 */
const BMS_SERIES_BALANCE_LANE_BITS = 30

/**
 * Native `getHistoryRange` shape: board samples arrive as one columnar Float64 ArrayBuffer (25
 * lanes/sample, row-major) plus a device dictionary, instead of an array of ~25-field objects. This
 * replaces N×25 per-field JSI conversions with a single buffer transfer; see decodeBoardSamples.
 */
/**
 * @parity /modules/vescape-core/ios/telemetry/TelemetryRangePayload.swift `getRange`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `getRange`
 */
interface NativeHistoryRange {
  boardColumns: ArrayBuffer
  boardCount: number
  boardDevices: (string | null)[]
  boardDeviceNames: string[]
  chartColumns?: ArrayBuffer
  chartCount?: number
  gpsSamples: HistoryGpsSample[]
  markers: HistoryMarker[]
  exclusions: MetricExclusion[]
}

const nullableLane = (value: number): number | null => (Number.isNaN(value) ? null : value)

/**
 * Rebuild TelemetrySample objects from the columnar buffer locally (no per-field bridge crossing).
 *
 * Lane order is shared by convention with the native encoders and is not self-describing — a lane
 * added on one side without the others shifts every field after it, silently.
 *
 * @parity /modules/vescape-core/ios/telemetry/TelemetryRepository.swift
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt
 */
function decodeBoardSamples(
  range: NativeHistoryRange,
  columns: ArrayBuffer = range.boardColumns,
  count: number = range.boardCount,
): TelemetrySample[] {
  const { boardDevices, boardDeviceNames } = range
  if (!count || !columns) return []
  const lanes = new Float64Array(columns)
  const samples = new Array<TelemetrySample>(count)
  for (let i = 0; i < count; i++) {
    const o = i * SAMPLE_COLUMN_COUNT
    const deviceIndex = lanes[o + 2]
    samples[i] = {
      id: lanes[o],
      capturedAtMs: lanes[o + 1],
      deviceId: boardDevices[deviceIndex] ?? null,
      deviceName: boardDeviceNames[deviceIndex],
      speedKmh: lanes[o + 3],
      batteryVoltage: lanes[o + 4],
      batteryPercent: nullableLane(lanes[o + 5]),
      motorCurrent: lanes[o + 6],
      batteryCurrent: lanes[o + 7],
      dutyCycle: lanes[o + 8],
      pitch: lanes[o + 9],
      roll: lanes[o + 10],
      balancePitch: lanes[o + 11],
      balanceCurrent: lanes[o + 12],
      erpm: lanes[o + 13],
      state: lanes[o + 14],
      switchState: lanes[o + 15],
      adc1: lanes[o + 16],
      adc2: lanes[o + 17],
      odometer: nullableLane(lanes[o + 18]),
      tempMosfet: nullableLane(lanes[o + 19]),
      tempMotor: nullableLane(lanes[o + 20]),
      hasFault: lanes[o + 21] !== 0,
      faultCode: lanes[o + 22],
      latitude: nullableLane(lanes[o + 23]),
      longitude: nullableLane(lanes[o + 24]),
    }
  }
  return samples
}

interface NativeBmsSeriesEvent {
  mode: 'snapshot' | 'append'
  generation: number
  windowMs: number
  cellCount: number
  count: number
  columns: ArrayBuffer
}

const hasLaneBit = (bits: number, bit: number): boolean => Math.floor(bits / 2 ** bit) % 2 === 1

/**
 * Decode the Live BMS Series columnar buffer from native into public domain frames.
 *
 * @parity /modules/vescape-core/ios/telemetry/BmsSeriesRing.swift `encodeBmsSeriesColumns`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/BmsSeriesRing.kt `encodeBmsSeriesColumns`
 */
function decodeBmsSeriesFrames(event: NativeBmsSeriesEvent): BmsSeriesFrame[] {
  const { cellCount, count, columns } = event
  if (!count || !cellCount || !columns) return []
  const laneCount = BMS_SERIES_FIXED_LANES + cellCount
  const lanes = new Float64Array(columns)
  const frameCount = Math.min(count, Math.floor(lanes.length / laneCount))
  const frames = new Array<BmsSeriesFrame>(frameCount)
  for (let row = 0; row < frameCount; row++) {
    const o = row * laneCount
    const bitsLo = lanes[o + 1]
    const bitsHi = lanes[o + 2]
    const cellVoltages = new Array<number>(cellCount)
    const balancing = new Array<boolean>(cellCount)
    for (let cell = 0; cell < cellCount; cell++) {
      cellVoltages[cell] = lanes[o + BMS_SERIES_FIXED_LANES + cell]
      balancing[cell] =
        cell < BMS_SERIES_BALANCE_LANE_BITS
          ? hasLaneBit(bitsLo, cell)
          : hasLaneBit(bitsHi, cell - BMS_SERIES_BALANCE_LANE_BITS)
    }
    frames[row] = {
      capturedAt: lanes[o],
      cellVoltages,
      balancing,
    }
  }
  return frames
}

export interface TelemetrySummary {
  sampleCount: number
  gpsPointCount: number
  firstAtMs: number | null
  lastAtMs: number | null
  droppedPendingSamples: number
}

/**
 * One Favorite: a durable, optionally named time range over Ride History (ADR 0029). Identity,
 * timestamps and the summary stats are native-owned — JS only ever sends a range and a name.
 *
 * @parity /modules/vescape-core/ios/telemetry/FavoriteStore.swift `Favorite`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt `FavoriteEntity`
 */
export interface Favorite {
  id: string
  /**
   * Owning Board (`Board.id`), or null when the recorded samples match no saved Board. Never a BLE
   * peripheral id: that changes on re-link and differs per install, so it is not an identity.
   */
  boardId: string | null
  /** Resolved from `boards` on read, not snapshotted — board renames propagate to old Favorites. */
  boardName: string | null
  name: string | null
  startMs: number
  endMs: number
  createdAtMs: number
  updatedAtMs: number
  sampleCount: number
  gpsPointCount: number
  /** Null when the favorited range carries no distance source. */
  distanceM: number | null
  movingDurationMs: number
  avgSpeedKmh: number
  maxSpeedKmh: number
  batteryUsedWh: number
}

/**
 * @parity /modules/vescape-core/ios/telemetry/TelemetryRepository.swift `createFavorite`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `createFavorite`
 */
export interface CreateFavoriteOptions {
  startMs: number
  endMs: number
  deviceId?: string
  name?: string
}

/**
 * @parity /modules/vescape-core/ios/telemetry/TelemetryRepository.swift `updateFavorite`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `updateFavorite`
 */
export interface UpdateFavoriteOptions {
  startMs: number
  endMs: number
  deviceId?: string
  name: string | null
}

/**
 * One immutable Favorite Media manifest row. Native owns metadata and canonical storage.
 * @parity /modules/vescape-core/ios/telemetry/FavoriteMediaStore.swift `FavoriteMedia`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt `FavoriteMediaEntity`
 */
export interface FavoriteMedia {
  id: string
  favoriteId: string
  capturedAtMs: number | null
  mimeType: string
  mediaKind: 'photo' | 'video'
  byteCount: number
  contentHash: string
  createdAtMs: number
  uri: string
  filename: string
}

export interface ImportFavoriteMediaOptions {
  favoriteId: string
  uri: string
  capturedAtMs?: number
  mimeType: string
  mediaKind: 'photo' | 'video'
}

export interface RefloatConfigField {
  id: string
  label: string
  value: number | boolean | string
  unit: string | null
  min: number | null
  max: number | null
}

export interface RefloatConfigGroup {
  id: string
  title: string
  fields: RefloatConfigField[]
}

export interface RefloatConfigSnapshot {
  capturedAt: number
  boardId: string | null
  canId: number
  schemaHash: string
  rawConfigHash: string
  rawConfigLength: number
  groups: RefloatConfigGroup[]
  missingFieldIds: string[]
  fwVersion: string | null
  refloatVersion?: string | null
  refloatBaseVersion?: string | null
}

export type TuneProfileFieldValue = number | boolean | string | null

export interface TuneProfile {
  id: string
  boardId: string
  refloatBaseVersion: string
  name: string
  icon: string
  color: string
  fields: Record<string, TuneProfileFieldValue>
  createdAt: number
  updatedAt: number
}

export interface TuneHistoryEntry {
  id: number
  profileId: string
  fields: Record<string, TuneProfileFieldValue>
  createdAt: number
}

export interface ProfileStats {
  distanceM: number | null
  rideCount: number
  rideTimeMs: number
  topSpeedKmh: number
  avgSpeedKmh: number
  longestRideM: number | null
  batteryUsedWh: number | null
  batteryRegenWh: number | null
}

export interface ProfileStatsMonth {
  year: number
  month: number
}

export interface LegalPolicyReference {
  jurisdictionCode: string
}

/**
 * Durable app-scoped settings. The keys here are a TS/Android/iOS parity triangle — every field is
 * persisted natively and projected back through {@link getSettings}/{@link updateSetting}. The
 * container tag covers all keys; individual literals are not tagged separately (see AGENTS.md).
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt `AppSettings`
 * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `defaultSettings`
 */
export interface AppSettings {
  liveHistoryLimit: number
  autoConnect: boolean
  autoRecording: boolean
  selectedBoardId: string | null
  lastGpsLatitude: number | null
  lastGpsLongitude: number | null
  /** Personal direction target; `null` when the rider has none. */
  directionPointLatitude: number | null
  directionPointLongitude: number | null
  movingSpeedThresholdKmh: number
  freeSpinMaxSpeedDeltaKmh: number
  freeSpinStationaryBoardCapKmh: number
  /**
   * Minutes of no recorded samples that end a ride: a longer stop starts a new one in the history
   * list and in profile stats. Read-time grouping, so changing it re-groups existing rides too.
   */
  rideSplitGapMinutes: number
  mapStyleKey: 'onedark' | 'outdoors' | 'satellite' | 'mapy'
  /** Use the custom satellite overlay style instead of the stock satellite style. */
  satelliteOverlayEnabled: boolean
  /** Satellite basemap imagery opacity, 0.1-1.0. Labels and app overlays stay full opacity. */
  satelliteImageryOpacity: number
  /** Satellite basemap imagery opacity for Explore/map mode, 0.1-1.0. */
  satelliteMapImageryOpacity: number
  /** Satellite basemap saturation for the telemetry/home map, -1.0 to 1.0. */
  satelliteImagerySaturation: number
  /** Hide POI names and icons on the telemetry/home map. Explore keeps map details visible. */
  hideTelemetryMapDetails: boolean
  mapOrientationMode: 'northUp' | 'gpsHeading' | 'phoneHeading' | 'freeRotate'
  historyMetricGradientsEnabled: boolean
  historyMetricHotRanges: Partial<
    Record<
      | 'speed'
      | 'duty'
      | 'battery'
      | 'tempMotor'
      | 'tempController'
      | 'motorCurrent'
      | 'batteryCurrent',
      { start: number; end: number }
    >
  >
  /** Battery SoC Estimate median window, seconds. 0 = off. See ADR-0016. */
  socEstimateWindowSeconds: number
  /**
   * Board Move strength as a percentage of the full remote input, 10..100. The board still clamps
   * the result with its own `remote.max_move_speed` / `remote_throttle_current_max`.
   */
  boardMoveStrengthPercent: number
  /** Play on/off sounds on board connect and involuntary disconnect. */
  connectionSoundsEnabled: boolean
  /** Android-only: use CompanionDeviceManager presence to connect associated boards when nearby. */
  companionPresenceEnabled: boolean
  /**
   * Board Warnings master switch (kill switch). Off ⇒ native runs no warning detector evaluation
   * and no registry writes; JS hides the warning icon/sheet. Stored warnings are left untouched
   * and reappear on re-enable. Takes effect live, no reconnect needed.
   */
  boardWarningsEnabled: boolean
  /**
   * Android-only: minutes to pause companion auto start after the user exits the app
   * manually, so the board reappearing doesn't immediately relaunch it. 0 = off.
   */
  companionPresenceCooldownMinutes: number
  /**
   * Android-only: close the whole app (task + service) after `autoCloseDelayMinutes` without a
   * board connection. Does not pause companion auto start — the board reappearing relaunches.
   */
  autoCloseEnabled: boolean
  /** Minutes without a board connection before auto close fires. UI offers 1–480; native accepts up to 1440. */
  autoCloseDelayMinutes: number
  /**
   * Max telemetry poll rate in Hz, applied as a minimum spacing floor between
   * requests. Polling stays response-paced (the next request is only sent once
   * the previous reply lands), so this caps the rate without ever outrunning the
   * controller. 0 = unlimited (pure response-paced, the original behaviour).
   */
  telemetryPollRateHz: number
  /**
   * Watch push rate in Hz — the cadence of the dedicated watch tick, independent
   * of the board poll rate. Higher values increase the wrist update rate for
   * stress-testing the link. Clamped to 1–20 Hz.
   */
  wearPushRateHz: number
  /**
   * Android-only: bring the Watch Mirror to the foreground on the paired watch when a fresh
   * board session connects (never on mid-ride auto-reconnects). No-op unless the Mirror app
   * is installed and reachable.
   */
  wearAutoLaunchOnConnect: boolean
  /**
   * Android-only, off by default: draw the direction chevron on the Watch Mirror. Only the
   * chevron — the wrist keeps drawing the route, rider dot and remaining distance either way.
   * Mirrored to the wrist over the settings path.
   */
  wearNavArrowEnabled: boolean
  /**
   * Persistent device-scoped anonymous Group Ride Rider id. Generated once on
   * first use and stored locally; sent to the relay server as the Rider's
   * identity. See ADR-0020.
   */
  riderId: string | null
  /** Rider-chosen display name shown to other Riders in a Group Ride. */
  riderName: string | null
  /** Rider-chosen marker color (hex) shown on other Riders' maps. Null when unset. */
  riderColor: string | null
  /** Native-resolved app-wide jurisdiction reference. Policy values live in shared catalog data. */
  legalPolicy: LegalPolicyReference | null
  /**
   * Community Message IDs the rider permanently acknowledged (dismissed or acted on). A dismissed
   * ID stays hidden across launches; a revised message re-appears only under a new ID. Native stores
   * only the IDs — never the server messages themselves. Absent/empty means nothing acknowledged.
   */
  dismissedCommunityMessageIds: string[]
}

export interface CompanionPresenceBoard {
  boardId: string
  name: string
  bleId: string
}

export interface DiagnosticStatus {
  captureCount: number
  lastEventName: string | null
  lastCaptureAt: number | null
}

export interface LocalDiagnosticEvent {
  id: number
  occurredAtMs: number
  eventName: string
  operation: string | null
  phase: string | null
  deviceId: string | null
  deviceName: string | null
  message: string | null
  propertiesJson: string
}

export interface TelemetryRebuildProgressEvent {
  current: number
  total: number
}

export interface DatabaseBackupResult {
  uri: string
  name: string
  sizeBytes: number
}

/** Raw BLE debug capture stored on-device by the native module. */
export interface DebugRecording {
  name: string
  createdAt: number
  sizeBytes: number
}

/**
 * Replay fixture bundled into app assets from `shared/fixtures/` (no capture timestamp).
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/replay/ReplayRecordings.kt `listBundled`
 * @parity /modules/vescape-core/ios/replay/ReplayRecordings.swift `listBundled`
 */
export interface DebugFixture {
  name: string
  sizeBytes: number
}

/**
 * Board-id prefix marking a native replay session (ADR 0024). The synthetic replay board id is
 * `replay:<recording-name>`; JS derives all replay presentation (REPLAY badge) from this prefix
 * instead of a parallel state flag.
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `startDebugReplay`
 * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `startReplay`
 */
export const REPLAY_BOARD_ID_PREFIX = 'replay:'

/**
 * Opt-in fast-forward for the opening stretch of a replay, so a session can come up with its live
 * charts already filled instead of spending real minutes earning them. Omitted entirely, a replay
 * runs the whole recording at 1×.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/replay/ReplayClock.kt
 * @parity /modules/vescape-core/ios/replay/ReplayClock.swift
 */
export interface DebugReplayOptions {
  /** How much of the recording plays faster than real time. `0` (default) is a plain 1× replay. */
  warmupMs?: number
  /** How much faster than real time that window is delivered. Default `1`. */
  warmupSpeed?: number
}

/** Whether a connected board id belongs to a dev-mode replay session. */
export function isReplayBoardId(boardId: string | null | undefined): boolean {
  return boardId?.startsWith(REPLAY_BOARD_ID_PREFIX) ?? false
}

// ---------------------------------------------------------------------------
// Typed emitter
// ---------------------------------------------------------------------------

/** Batched history payload: full samples flushed by native a few times per second. */
export interface TelemetryHistoryEvent {
  samples: TelemetryEvent[]
}

/**
 * Decimated live sparkline series, computed natively from the in-memory window.
 * Each metric is a flat `[ts0, v0, ts1, v1, ...]` array (min/max per time bucket),
 * so the strip (and, while the perf flag is on, the `/control` detail charts) render
 * without streaming raw samples across the bridge.
 */
export interface LiveSeriesEvent {
  metrics: Record<string, number[]>
  generation: number
}

/**
 * High-resolution series for the one metric a `/control` detail chart has focused,
 * emitted natively at full resolution (20ms buckets). `series` and each `exclusions` entry
 * are flat `[ts0, v0, ts1, v1, ...]` / `[start0, end0, ...]` arrays. Excluded spans ride
 * along per exclusion key so JS can rebuild overlay bands without raw samples.
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/LiveSeriesEmitter.kt `emitFocusedSeries`
 * @parity /modules/vescape-core/ios/telemetry/LiveSeriesEmitter.swift `emitFocusedSeries`
 */
export interface FocusedSeriesEvent {
  metric: string
  series: number[]
  exclusions: Record<string, number[]>
  windowMs: number
  /** Elapsed time actually covered by the retained samples (≤ `windowMs` right after connect). */
  spanMs: number
  /** Measured packet rate over `spanMs`; 0 until two samples exist. */
  sampleRateHz: number
  generation: number
}

// ---------------------------------------------------------------------------
// Group Ride (observe) — wire protocol mirror of vescape-server
// docs/group-ride/PROTOCOL.md. Observing only receives; it sends nothing.
// ---------------------------------------------------------------------------

/** Globally-broadcast ride view; identical in `snapshot` and `ride-created`. */
export interface GroupRideSummary {
  id: string
  name: string
  /** Epoch ms when the ride was created. */
  createdAt: number
  riderCount: number
  /** Reference point = creator's latest location, for client-side distance filtering. */
  location: { lat: number; lng: number }
  creator: { id: string; name: string }
}

export interface RiderPresence {
  lat: number
  lng: number
  heading?: number | null
  /** Board-enriched speed in m/s. Null/omitted when no fresh Board Session is live. */
  speed?: number | null
  /** Battery SoC Estimate as a 0-1 fraction. Null/omitted when unavailable. */
  soc?: number | null
  /** Motor temperature in °C. Null/omitted when no fresh Board Session is live. */
  motorTemp?: number | null
  /** Controller/FET temperature in °C. Null/omitted when no fresh Board Session is live. */
  ctrlTemp?: number | null
  /** Device battery as a 0-1 fraction. Null/omitted when the platform can't report it. */
  phoneBattery?: number | null
  /** Connected board's display name. Null/omitted when no Board Session is live. */
  boardName?: string | null
  /** The Rider's shared map target (their direction point). Null/omitted when none is set. */
  target?: { lat: number; lng: number } | null
}

/** One breadcrumb in a Rider's recent shared path. */
export interface TrailPoint {
  lat: number
  lng: number
}

export interface GroupRideRider {
  id: string
  name: string
  /** Rider-chosen marker color (hex), or null when unset. */
  color: string | null
  presence: RiderPresence | null
  /** Recent path (oldest → newest), server-capped to ~30s. Null/omitted while empty. */
  trail?: TrailPoint[] | null
  stale: boolean
  lastSeen: number
}

/**
 * Observe-socket lifecycle. `blocked` is the Online Capability gate: native refuses to open (or tears
 * down) the relay socket while App Status is Online Blocked or App Blocked, so JS renders an
 * update-required surface instead of a disconnect loop.
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/GroupRideObserver.kt `emitConnection`
 * TODO(iOS parity): no iOS peer — Group Ride is not ported yet.
 */
export type GroupRideConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'blocked'

export interface GroupRideConnectionEvent {
  state: GroupRideConnectionState
}

export interface GroupRideSnapshotEvent {
  rides: GroupRideSummary[]
}

export interface GroupRideCreatedEvent {
  ride: GroupRideSummary
}

export interface GroupRideUpdatedEvent {
  ride: GroupRideSummary
}

export interface GroupRideEndedEvent {
  rideId: string
}

export interface GroupRideJoinedEvent {
  rideId: string | null
}

export interface GroupRideRosterEvent {
  rideId: string | null
  riders: GroupRideRider[]
}

export interface GroupRideErrorEvent {
  message: string
}

/**
 * Native persisted board/app data changed outside a JS-initiated write (e.g. the per-board
 * `lastBattery` written on session end). JS owns no durable copy, so it must reload the matching
 * store to stay fresh without an app restart. Emitted sparingly — only on meaningful changes,
 * never per telemetry tick.
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `AppDataScope`
 * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `AppDataScope`
 */
export interface AppDataChangedEvent {
  scope: 'boards' | 'settings'
}

/**
 * Two-level Board Warning severity, fixed at detection time.
 * @parity /modules/vescape-core/ios/warnings/BoardWarningKind.swift `BoardWarningSeverity`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/warnings/BoardWarningRegistry.kt `BoardWarningSeverity`
 */
export type BoardWarningSeverity = 'warn' | 'critical'

/**
 * Every Board Warning kind slug the native detectors currently emit. Mirrors the native `BoardWarningKind`
 * catalog on both platforms; a rider-facing title is required per kind (see `WARNING_TITLES`). A `BoardWarning`
 * from a newer native build may carry a kind outside this union, so consumers still fall back to the raw slug.
 * @parity /modules/vescape-core/ios/warnings/BoardWarningKind.swift `BoardWarningKind`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/warnings/BoardWarningKind.kt `BoardWarningKind`
 */
export type BoardWarningKind =
  | 'cell-spread'
  | 'battery-config-mismatch'
  | 'footpad-disabled'
  | 'lv-pushback-low'
  | 'hv-pushback-high'
  | 'duty-pushback-high'
  | 'moving-fault-disabled'

/**
 * One durable Board Warning — an app-detected abnormal Board condition, keyed one-per-problem-kind
 * per Board (automotive fault-code model). Detected natively; JS only renders. `payloadJson` carries
 * kind-specific detail (e.g. peak cell spread) as a JSON string the rendering side decodes per kind.
 * @parity /modules/vescape-core/ios/warnings/BoardWarningStore.swift `BoardWarning`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/warnings/BoardWarningRegistry.kt `BoardWarning`
 */
export interface BoardWarning {
  boardId: string
  kind: string
  severity: BoardWarningSeverity
  firstDetectedAtMs: number
  lastDetectedAtMs: number
  payloadJson: string
}

/**
 * Full current warning list for one Board, emitted on every registry change and on subscribe (late
 * subscribers are immediately consistent). The JS mirror store replaces that board's slice on each
 * emit — JS never detects, only displays.
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `sendBoardWarnings`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `onBoardWarnings`
 */
export interface BoardWarningsEvent {
  boardId: string
  warnings: BoardWarning[]
}

/**
 * Release Policy outcome for the installed marketing version, resolved **by the server**. Native
 * never evaluates SemVer ranges and JS never sees one — both only carry the resolved slug.
 * @parity /modules/vescape-core/ios/appstatus/AppStatus.swift `AppVersionStatus`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatus.kt `AppVersionStatus`
 */
export type AppVersionStatus = 'current' | 'update-warning' | 'online-blocked' | 'app-blocked'

/**
 * @parity /modules/vescape-core/ios/appstatus/AppStatus.swift `CommunityMessageType`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatus.kt `CommunityMessageType`
 */
export type CommunityMessageType = 'info' | 'warning' | 'critical'

/**
 * @parity /modules/vescape-core/ios/appstatus/AppStatus.swift `CommunityMessageActionType`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatus.kt `CommunityMessageActionType`
 */
export type CommunityMessageActionType = 'primary' | 'secondary'

/**
 * @parity /modules/vescape-core/ios/appstatus/AppStatus.swift `CommunityMessageAction`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatus.kt `CommunityMessageAction`
 */
export interface CommunityMessageAction {
  type: CommunityMessageActionType
  label: string
  url: string
}

/**
 * A server-authored announcement. Independent from Release Policy: a Community Message never
 * changes whether a capability is available.
 * @parity /modules/vescape-core/ios/appstatus/AppStatus.swift `CommunityMessage`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatus.kt `CommunityMessage`
 */
export interface CommunityMessage {
  id: string
  type: CommunityMessageType
  /** Server-authored headline. `null` falls back to the per-type label. */
  title: string | null
  /** Markdown body, rendered by `Markdown`. */
  body: string
  action: CommunityMessageAction | null
}

/**
 * @parity /modules/vescape-core/ios/appstatus/AppStatus.swift `AppStatusVersion`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatus.kt `AppStatusVersion`
 */
export interface AppStatusVersion {
  /** Installed marketing version the server resolved this status from. */
  installed: string
  /** Latest shared Android/iOS marketing version the server advertises. */
  latest: string
  status: AppVersionStatus
  /** Server-authored Markdown for the matched rule; `null` when the rule carries none. */
  message: string | null
}

/**
 * One resolved App Status snapshot. Native holds it in memory for the running process only — it is
 * never persisted, so a fresh process starts unknown (`null`) and fails open until a fetch lands.
 * @parity /modules/vescape-core/ios/appstatus/AppStatus.swift `AppStatus`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatus.kt `AppStatus`
 */
export interface AppStatus {
  version: AppStatusVersion
  messages: CommunityMessage[]
}

/**
 * Native App Status changed. Emitted on every successful refresh and replayed on subscribe, so a
 * late listener is immediately consistent. `null` means no successful fetch in this process yet.
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `sendAppStatus`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `onAppStatus`
 */
export interface AppStatusEvent {
  status: AppStatus | null
}

/**
 * The condition pictogram a forecast resolves to. Native classifies the WMO code; this side only
 * picks artwork and a tint for the slug it is handed, so the phone, the wrist and iOS cannot
 * disagree about what the weather is.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/Weather.kt `WeatherIcon`
 * @parity /modules/vescape-core/ios/weather/Weather.swift `WeatherIcon`
 */
export type WeatherIconSlug =
  | 'sun'
  | 'moon'
  | 'cloud-sun'
  | 'cloud-moon'
  | 'cloud'
  | 'cloud-fog'
  | 'cloud-rain'
  | 'cloud-snow'
  | 'cloud-lightning'

/**
 * One forecast hour. `minuteOfDay` is minutes since midnight **local to the forecast location**, so
 * it is a label to render and not a timestamp to compare against `Date.now()`.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/Weather.kt `WeatherHour`
 * @parity /modules/vescape-core/ios/weather/Weather.swift `WeatherHour`
 */
export interface WeatherHour {
  minuteOfDay: number
  temperatureC: number
  weatherCode: number
  icon: WeatherIconSlug
  precipitationProbability: number
}

/**
 * The weather where the rider is, computed natively. JS renders it and nothing else: there is no
 * fetch on this side, no cache, and no way to ask for a refresh — the forecast follows GPS Fixes,
 * which native owns, and it keeps updating while the JS runtime is gone.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/Weather.kt `Weather`
 * @parity /modules/vescape-core/ios/weather/Weather.swift `Weather`
 */
export interface Weather {
  temperatureC: number
  weatherCode: number
  icon: WeatherIconSlug
  label: string
  precipitationProbability: number
  hourly: WeatherHour[]
  /** Minutes since local midnight, or `null` when the forecast omitted the day's sun times. */
  sunriseMinuteOfDay: number | null
  sunsetMinuteOfDay: number | null
  latitude: number
  longitude: number
  fetchedAtMs: number
}

/**
 * Native forecast changed. Emitted on every successful refresh and replayed on subscribe, so a late
 * listener is immediately consistent. `null` means no successful fetch in this process yet.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `onWeather`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `sendWeather`
 */
export interface WeatherEvent {
  weather: Weather | null
}

/**
 * The rideable path from the rider to their Direction Point, computed natively. JS renders it and
 * nothing else: there is no routing logic on this side, and a Navigation never changes on its own.
 *
 * `coordinates` are GeoJSON `[longitude, latitude]` pairs — the opposite order from
 * `setDirectionPoint(latitude, longitude)` — so they feed a `ShapeSource` unmodified.
 *
 * It is durable: native stores it and restores it on cold start, so a `computedAtMs` days old is
 * expected and is not a reason to ask for a new one. Nothing on this side refetches.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationController.kt `Navigation`
 * @parity /modules/vescape-core/ios/navigation/NavigationController.swift `Navigation`
 */
export interface Navigation {
  target: { latitude: number; longitude: number }
  /**
   * Navigation Profile the path was produced under, and the one the switcher shows as current. It
   * never changes for this Navigation — a different profile produces a new one in its place.
   */
  profile: NavigationProfile
  computedAtMs: number
  status: NavigationStatus
  /**
   * How far the path runs and how long the routing service thinks it takes. Both are `0` unless
   * `status` is `ready`, and both can be `0` on a path restored from before they were stored.
   *
   * The duration is the Navigation Profile's own estimate — a walking path is timed at walking
   * pace — so it says what shape the ride ahead is, not when an EUC gets there.
   */
  distanceMeters: number
  durationSeconds: number
  /** Empty unless `status` is `ready`. Never infer failure from this — read `status`. */
  coordinates: [longitude: number, latitude: number][]
}

/**
 * How a Navigation ended up. A Navigation exists for as long as its Direction Point does, so a
 * request that produced no path is still a Navigation — one that says why instead of drawing a line.
 *
 * - `ready` — a usable path was computed.
 * - `fetchFailed` — could not ask: no signal, timeout, API error. Worth retrying with signal.
 * - `noPathFound` — asked and answered, but nothing rideable leads there. Retrying from the same
 *   spot will say the same thing.
 *
 * Nothing retries on its own. `recomputeNavigation` is the only way a failed one is recomputed.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationController.kt `NavigationStatus`
 * @parity /modules/vescape-core/ios/navigation/NavigationController.swift `NavigationStatus`
 */
export type NavigationStatus = 'ready' | 'fetchFailed' | 'noPathFound'

/**
 * The kind of ways a Navigation may follow. The rider picks it inline on the path view — there is
 * no settings-screen entry — and the choice sticks as the default for the next Navigation.
 *
 * - `walking` — footpaths and forest tracks, which is where Direction Points usually are. The
 *   default when the rider has never chosen.
 * - `cycling` — cycleways and roads; refuses footpaths.
 * - `driving` — roads only.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationController.kt `NavigationProfile`
 * @parity /modules/vescape-core/ios/navigation/NavigationController.swift `NavigationProfile`
 */
export type NavigationProfile = 'walking' | 'cycling' | 'driving'

/**
 * Native Navigation changed. Emitted whenever it is computed or cleared, and replayed on subscribe,
 * so a late listener is immediately consistent. `null` means no Navigation — no Direction Point is
 * set, or the path could not be computed.
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `sendNavigation`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `onNavigation`
 */
export interface NavigationEvent {
  navigation: Navigation | null
  /**
   * Whether native is computing a path right now. The one part of Navigation state that is not
   * durable, and the only reason a rider's tap is allowed to look like it did something before a
   * result exists: a recompute that fails publishes no new Navigation at all.
   */
  computing: boolean
}

/**
 * Where the rider is along their Navigation right now, computed natively on every GPS Fix. JS reads
 * it and derives nothing: there is no projection, no along-path arithmetic and no straight-line
 * fallback on this side.
 *
 * Attachment is unconditional — there is no off-route state — so on a path that passes near itself
 * `remainingMeters` can jump as the projection snaps between legs. That is known and accepted.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/RouteProgress.kt `RouteProgress`
 * @parity /modules/vescape-core/ios/navigation/RouteProgress.swift `RouteProgress`
 */
export interface RouteProgress {
  /** The point on the path nearest to the rider. */
  latitude: number
  longitude: number
  /** Metres left to the Direction Point measured along the path, not as the crow flies. */
  remainingMeters: number
  /**
   * Absolute degrees clockwise from north, aimed a short way further along the path. Absolute, not
   * relative to where the rider is pointing — rotate it yourself if a view needs it rider-up.
   */
  bearingDeg: number
}

/**
 * Native Route Progress changed. Emitted on every GPS Fix that moves it, replayed on subscribe, and
 * `null` whenever there is no Navigation to be along — including the moment one is replaced, before
 * the next fix refills it.
 *
 * Separate from `onNavigation` because this fires at ~1 Hz and the path itself does not change.
 *
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `sendRouteProgress`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `onRouteProgress`
 */
export interface RouteProgressEvent {
  progress: RouteProgress | null
}

/**
 * @parity /modules/vescape-core/ios/auth/DeviceCredentialStore.swift
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/auth/DeviceCredentialStore.kt
 */
export type DeviceCredentialState = 'unavailable' | 'ready' | 'rejected'

export interface DeviceCredentialStatus {
  state: DeviceCredentialState
  accountId: string | null
  expiresAt: string | null
}

export type CriticalRideNotificationPermissionStatus =
  | 'not-determined'
  | 'denied'
  | 'authorized'
  | 'provisional'
  | 'ephemeral'
  | 'unknown'

/**
 * Event names must match the native `Events(...)` declarations exactly — a name only listed here
 * yields a listener that never fires.
 *
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `Events`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `Events`
 */
type VescapeCoreEvents = {
  onDevice: (event: DeviceFoundEvent) => void
  onError: (event: ErrorEvent) => void
  onLiveState: (event: LiveStateEvent) => void
  /** High-frequency (per-frame) scalar tick for live gauges. No history, no nested arrays. */
  onLiveTick: (event: TelemetryEvent) => void
  /** Decimated per-metric min/max sparkline series (~1Hz) for the live strip. */
  onLiveSeries: (event: LiveSeriesEvent) => void
  /** Full-resolution series for each focused `/control` detail-chart metric (~1Hz). */
  onFocusedSeries: (event: FocusedSeriesEvent) => void
  /** Batched full samples (~3Hz) for history buffer and detail charts. */
  onTelemetryHistory: (event: TelemetryHistoryEvent) => void
  onBms: (event: BmsEvent) => void
  onBmsSeries: (event: NativeBmsSeriesEvent) => void
  onLocation: (event: LocationEvent) => void
  onReplayPhoneHeading: (event: { headingDeg: number }) => void
  onTelemetryRebuildProgress: (event: TelemetryRebuildProgressEvent) => void
  onBoardProbeProgress: (event: BoardProbeProgressEvent) => void
  /** Observe WebSocket connection state to the Group Ride relay. */
  onGroupRideConnection: (event: GroupRideConnectionEvent) => void
  /** Full active-ride list, sent once on connect. */
  onGroupRideSnapshot: (event: GroupRideSnapshotEvent) => void
  onGroupRideCreated: (event: GroupRideCreatedEvent) => void
  onGroupRideUpdated: (event: GroupRideUpdatedEvent) => void
  onGroupRideEnded: (event: GroupRideEndedEvent) => void
  onGroupRideJoined: (event: GroupRideJoinedEvent) => void
  onGroupRideRoster: (event: GroupRideRosterEvent) => void
  onGroupRideError: (event: GroupRideErrorEvent) => void
  /** Persisted board/app data changed natively — reload the matching store. */
  onAppDataChanged: (event: AppDataChangedEvent) => void
  /** Full current Board Warning list for a board, on every registry change and on subscribe. */
  onBoardWarnings: (event: BoardWarningsEvent) => void
  /** Native App Status, on every successful refresh and on subscribe. */
  onAppStatus: (event: AppStatusEvent) => void
  /** Native Navigation, on every change (including clears) and on subscribe. */
  onNavigation: (event: NavigationEvent) => void
  /** Native Route Progress, on every GPS Fix that moves it, on clears, and on subscribe. */
  onRouteProgress: (event: RouteProgressEvent) => void
  /** Native forecast, on every successful refresh and on subscribe. */
  onWeather: (event: WeatherEvent) => void
}

interface NativeEventEmitter<TEvents extends Record<string, (...args: never[]) => void>> {
  addListener<EventName extends keyof TEvents>(
    eventName: EventName,
    listener: TEvents[EventName],
  ): EventSubscription
  removeListener<EventName extends keyof TEvents>(
    eventName: EventName,
    listener: TEvents[EventName],
  ): void
  removeAllListeners(eventName: keyof TEvents): void
}

type VescapeCoreNativeModule = NativeEventEmitter<VescapeCoreEvents> & {
  scan(): void
  stopScan(): void
  exitApp(): void
  startLocationUpdates(): void
  stopLocationUpdates(): void
  startGroupRideObserve(serverUrl: string): void
  stopGroupRideObserve(): void
  createGroupRide(
    riderId: string,
    riderName: string,
    riderColor: string | null,
    name: string | null,
    lat: number,
    lng: number,
  ): void
  joinGroupRide(riderId: string, riderName: string, riderColor: string | null, rideId: string): void
  leaveGroupRide(): void
  updateGroupRideIdentity(riderId: string, riderName: string, riderColor: string | null): void
  setTelemetryRecordingEnabled(enabled: boolean): void
  setBmsSeriesFocused(focused: boolean): void
  setFocusedSeriesMetrics(metrics: string[]): void
  reloadAlertRules(): void
  getCriticalRideNotificationPermissionStatus(): Promise<CriticalRideNotificationPermissionStatus>
  requestCriticalRideNotificationPermission(): Promise<CriticalRideNotificationPermissionStatus>
  getAlertSounds(): AlertSound[]
  previewAlertSound(soundType: AlertSoundType): void
  startGeigerSimulation(soundType: string, rangeDepth: number): void
  stopGeigerSimulation(): void
  startAlertTest(rules: AlertTestRule[]): void
  updateAlertTest(value: number): void
  stopAlertTest(): void
  selectBoard(boardId: string): Promise<void>
  stopBoard(): Promise<void>
  probeBoardLink(bleId: string, probeId: string): Promise<BoardProbeResult>
  cancelBoardProbe(probeId: string): void
  setDebugRecordingEnabled(enabled: boolean): void
  listDebugRecordings(): Promise<DebugRecording[]>
  listBundledDebugFixtures(): Promise<DebugFixture[]>
  exportDebugRecording(name: string): Promise<DatabaseBackupResult>
  deleteDebugRecording(name: string): Promise<void>
  startDebugReplay(name: string, options: DebugReplayOptions | null): Promise<void>
  recordPhoneHeading(headingDeg: number): void
  setWatchRouteSpanM(spanM: number | null): void
  stopDebugReplay(): Promise<void>
  reportUiError(message: string, source?: string | null, stack?: string | null): void
  reportDiagnosticTest(): DiagnosticStatus
  getDiagnosticStatus(): DiagnosticStatus
  getLiveState(): LiveStateEvent
  getAppStatus(): AppStatus | null
  getWeather(): Weather | null
  refreshWeather(): void
  provisionDeviceCredential(
    serverUrl: string,
    deviceToken: string,
    accountId: string,
  ): Promise<DeviceCredentialStatus>
  getDeviceCredentialState(): DeviceCredentialStatus
  revokeDeviceCredential(): Promise<void>
  clearDeviceCredential(): void
  openAppUpdate(): void
  getRemoteTiltState(): RemoteTiltState | null
  setSelectedBoard(boardId: string | null): void
  setCompanionPresenceEnabled(enabled: boolean): Promise<void>
  getCompanionPresenceBoards(): Promise<CompanionPresenceBoard[]>
  addCompanionPresenceBoard(boardId: string): Promise<void>
  removeCompanionPresenceBoard(boardId: string): Promise<void>
  getTelemetryHistory(options: TelemetryHistoryOptions): Promise<TelemetryMinuteBucket[]>
  getTelemetrySamples(options: {
    fromMs: number
    toMs: number
    deviceId?: string
    limit?: number
  }): Promise<TelemetrySample[]>
  getHistoryRange(options: {
    fromMs: number
    toMs: number
    deviceId?: string
    limit?: number
  }): Promise<NativeHistoryRange>
  getTelemetrySummary(): Promise<TelemetrySummary>
  getFavorites(): Promise<Favorite[]>
  createFavorite(options: CreateFavoriteOptions): Promise<Favorite>
  updateFavorite(id: string, options: UpdateFavoriteOptions): Promise<Favorite>
  deleteFavorite(id: string): Promise<boolean>
  getFavoriteMedia(favoriteId: string): Promise<FavoriteMedia[]>
  importFavoriteMedia(options: ImportFavoriteMediaOptions): Promise<FavoriteMedia>
  getDiagnosticEvents(options: DiagnosticEventOptions): Promise<LocalDiagnosticEvent[]>
  clearDiagnosticEvents(): Promise<void>
  getBoardWarnings(): Promise<BoardWarning[]>
  clearBoardWarning(boardId: string, kind: string): Promise<void>
  clearAllBoardWarnings(boardId: string): Promise<void>
  devInjectBoardWarning(
    boardId: string,
    kind: string,
    severity: BoardWarningSeverity,
    payloadJson: string,
  ): Promise<void>
  devReportCleanBoardWarning(boardId: string, kind: string): Promise<void>
  getDatabaseSizeBytes(): Promise<number>
  backupDatabase(): Promise<DatabaseBackupResult>
  restoreDatabase(uri: string): Promise<void>
  getRefloatConfigSnapshot(): Promise<RefloatConfigSnapshot>
  setRemoteTilt(value: number): Promise<boolean>
  lockRemoteTilt(value: number): Promise<boolean>
  releaseRemoteTilt(value: number, durationMs: number): Promise<boolean>
  stopRemoteTilt(): Promise<boolean>
  startBoardMove(input: number): Promise<boolean>
  stopBoardMove(): Promise<boolean>
  getTuneProfiles(boardId: string, refloatBaseVersion?: string | null): Promise<TuneProfile[]>
  getTuneProfile(profileId: string): Promise<TuneProfile | null>
  createProfile(
    boardId: string,
    name: string,
    icon: string,
    color: string,
    fields: Record<string, TuneProfileFieldValue>,
    refloatBaseVersion: string,
  ): Promise<TuneProfile>
  renameProfile(profileId: string, name: string, icon: string, color: string): Promise<TuneProfile>
  deleteProfile(profileId: string): Promise<void>
  getProfileHistory(profileId: string): Promise<TuneHistoryEntry[]>
  rollbackProfile(profileId: string, historyEntryId: number): Promise<TuneProfile>
  copyProfileToBoard(
    profileId: string,
    targetBoardId: string,
    newName: string,
  ): Promise<TuneProfile>
  saveProfile(
    profileId: string,
    fields: Record<string, TuneProfileFieldValue>,
  ): Promise<TuneProfile>
  pushProfileToBoard(profileId: string): Promise<RefloatConfigSnapshot>
  getTotalProfileStats(): Promise<ProfileStats>
  getMonthlyProfileStats(options: ProfileStatsMonth): Promise<ProfileStats>
  getProfileStatMonths(): Promise<ProfileStatsMonth[]>
  rebuildTelemetryBuckets(): Promise<number>
  deleteTelemetryBefore(beforeMs: number): Promise<number>
  deleteTelemetryRange(options: TelemetryDeleteRangeOptions): Promise<number>
  clearTelemetryHistory(): Promise<void>
  getBoards(): Promise<Board[]>
  upsertBoard(board: Board): Promise<void>
  deleteBoard(id: string): Promise<void>
  getAlertRules(boardId: string): Promise<AlertRule[]>
  upsertAlertRule(rule: AlertRule): Promise<void>
  setAlertRuleEnabled(boardId: string, id: string, enabled: boolean): Promise<void>
  deleteAlertRule(boardId: string, id: string): Promise<void>
  getPrivacyZones(): Promise<PrivacyZone[]>
  upsertPrivacyZone(zone: PrivacyZone): Promise<void>
  setPrivacyZoneEnabled(id: string, enabled: boolean): Promise<void>
  deletePrivacyZone(id: string): Promise<void>
  getNearbyMapPoints(
    latitude: number,
    longitude: number,
    radiusMeters: number,
  ): Promise<NearbyMapPoints>
  createMapPoint(values: MapPointValues): Promise<MapPoint>
  updateMapPoint(id: string, patch: MapPointPatch): Promise<MapPoint>
  deleteMapPoint(id: string): Promise<void>
  setMapPointReaction(id: string, reaction: MapPointReaction | null): Promise<void>
  setDirectionPoint(latitude: number | null, longitude: number | null): Promise<void>
  recomputeNavigation(): Promise<void>
  setNavigationProfile(profile: NavigationProfile): Promise<void>
  getSettings(): Promise<AppSettings>
  refreshLegalPolicy(): Promise<void>
  setLegalMode(boardId: string, enabled: boolean): Promise<void>
  updateSetting(
    key: string,
    value: number | boolean | string | string[] | Record<string, unknown> | null,
  ): Promise<void>
}

const native = requireNativeModule<VescapeCoreNativeModule>('VescapeCore')
const emitter = native
const E2E_ENABLED = process.env.EXPO_PUBLIC_E2E === '1'

/**
 * BLE discovery is faked in the smoke run too, and only discovery.
 *
 * An emulator has no radio, so no harness can ever scan a real board — that fake stands in for
 * absent hardware. Every other `E2E_ENABLED` branch below stands in for absent *data*, which the
 * smoke run gets from a restored database and a replayed recording instead (`@/config/env`
 * `smokeMode`). Folding the two under one flag is what would make a smoke run assert against
 * `e2eFake` rather than the native stack it exists to test.
 */
const FAKE_SCAN = E2E_ENABLED || process.env.EXPO_PUBLIC_SMOKE === '1'

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Start BLE scan — emits onDevice events for every advertisement received. */
export function scan(): void {
  if (FAKE_SCAN) {
    e2eFake.scan()
    return
  }

  native.scan()
}

/** Stop ongoing BLE scan. */
export function stopScan(): void {
  if (FAKE_SCAN) {
    e2eFake.stopScan()
    return
  }

  native.stopScan()
}

/** Start app-level Android location updates independently of a board session. */
export function startLocationUpdates(): void {
  native.startLocationUpdates()
}

/** Stop app-level Android location updates. Board sessions manage their own recording location. */
export function stopLocationUpdates(): void {
  native.stopLocationUpdates()
}

/**
 * Start the native Group Ride observe WebSocket (lives in the foreground service).
 * Observing only receives lifecycle events — it sends no location.
 */
export function startGroupRideObserve(serverUrl: string): void {
  if (E2E_ENABLED) return
  native.startGroupRideObserve(serverUrl)
}

/** Stop the native Group Ride observe WebSocket. */
export function stopGroupRideObserve(): void {
  if (E2E_ENABLED) return
  native.stopGroupRideObserve()
}

export interface CreateGroupRideParams {
  /** Persistent device-scoped Rider id. */
  riderId: string
  /** Rider display name bound to the connection (used for the auto-name fallback). */
  riderName: string
  /** Rider-chosen marker color (hex), bound to the connection. Null when unset. */
  riderColor: string | null
  /** Optional custom ride name; server auto-names `"<name>'s ride"` when blank/null. */
  name: string | null
  lat: number
  lng: number
}

/**
 * Create a Group Ride over the live observe socket. Sends the creator's location once — the
 * only location egress while observing. The new ride arrives back via the `ride-created`
 * fan-out, so callers update state from that event rather than optimistically.
 */
export function createGroupRide({
  riderId,
  riderName,
  riderColor,
  name,
  lat,
  lng,
}: CreateGroupRideParams): void {
  if (E2E_ENABLED) return
  native.createGroupRide(riderId, riderName, riderColor, name, lat, lng)
}

export interface JoinGroupRideParams {
  riderId: string
  riderName: string
  riderColor: string | null
  rideId: string
}

/** Join a Group Ride by id. Native sends Rider Presence from the foreground GPS stream. */
export function joinGroupRide({
  riderId,
  riderName,
  riderColor,
  rideId,
}: JoinGroupRideParams): void {
  if (E2E_ENABLED) return
  native.joinGroupRide(riderId, riderName, riderColor, rideId)
}

/** Leave the current Group Ride. */
export function leaveGroupRide(): void {
  if (E2E_ENABLED) return
  native.leaveGroupRide()
}

export interface UpdateGroupRideIdentityParams {
  riderId: string
  riderName: string
  riderColor: string | null
}

/**
 * Push a Rider name/color change to the live observe socket. While joined, the relay
 * re-emits the roster so peers update without a rejoin; otherwise the new identity is
 * applied on the next create/join. No-op when the observe socket is not connected.
 */
export function updateGroupRideIdentity({
  riderId,
  riderName,
  riderColor,
}: UpdateGroupRideIdentityParams): void {
  if (E2E_ENABLED) return
  native.updateGroupRideIdentity(riderId, riderName, riderColor)
}

/** Enable or disable native SQLite telemetry history writes. */
export function setTelemetryRecordingEnabled(enabled: boolean): void {
  native.setTelemetryRecordingEnabled(enabled)
}

/** Open/close native bridge pushes for the Live BMS Series. Native retention keeps running. */
export function setBmsSeriesFocused(focused: boolean): void {
  native.setBmsSeriesFocused(focused)
}

/** Set the metric keys the high-res `onFocusedSeries` stream covers (empty array to stop it). */
export function setFocusedSeriesMetrics(metrics: string[]): void {
  native.setFocusedSeriesMetrics(metrics)
}

/** Tell the Android foreground service to re-read alert rules from native storage. */
export function reloadAlertRules(): void {
  native.reloadAlertRules()
}

/** Read iOS local-notification permission used only for critical ride alerts. */
export async function getCriticalRideNotificationPermissionStatus(): Promise<CriticalRideNotificationPermissionStatus> {
  try {
    return await native.getCriticalRideNotificationPermissionStatus()
  } catch {
    return 'unknown'
  }
}

/** Explicitly request iOS permission for critical ride alert notifications. Never called on connect. */
export async function requestCriticalRideNotificationPermission(): Promise<CriticalRideNotificationPermissionStatus> {
  try {
    return await native.requestCriticalRideNotificationPermission()
  } catch {
    return 'unknown'
  }
}

const FALLBACK_PRESETS: AlertSound[] = [
  { name: 'Beep', uri: 'preset:beep', category: 'single' },
  { name: 'Urgent', uri: 'preset:urgent', category: 'single' },
  { name: 'Notify', uri: 'preset:notify', category: 'single' },
  { name: 'Tick', uri: 'preset:tick', category: 'geiger' },
  { name: 'Hard Tick', uri: 'preset:tick_hard', category: 'geiger' },
  { name: 'Gamma', uri: 'preset:gamma', category: 'geiger' },
]

export function getAlertSounds(): AlertSound[] {
  try {
    return native.getAlertSounds()
  } catch {
    return FALLBACK_PRESETS
  }
}

export function previewAlertSound(soundType: AlertSoundType): void {
  native.previewAlertSound(soundType)
}

export function startGeigerSimulation(soundType: string, rangeDepth: number): void {
  try {
    native.startGeigerSimulation(soundType, rangeDepth)
  } catch {
    // Native geiger simulation not yet available
  }
}

export function stopGeigerSimulation(): void {
  try {
    native.stopGeigerSimulation()
  } catch {
    // Native geiger simulation not yet available
  }
}

/** Start an isolated alert-engine test from an exact JS rule snapshot (saved or wizard draft). */
export function startAlertTest(rules: AlertTestRule[]): void {
  try {
    native.startAlertTest(rules)
  } catch {
    // Older development clients may not expose the test bridge yet; the visual sweep still runs.
  }
}

/** Feed one normalized gauge value into the isolated alert test. */
export function updateAlertTest(value: number): void {
  try {
    native.updateAlertTest(value)
  } catch {
    // Native alert test not available in this development client.
  }
}

/** Stop only test feedback. Live Board alert state and playback remain untouched. */
export function stopAlertTest(): void {
  try {
    native.stopAlertTest()
  } catch {
    // Native alert test not available in this development client.
  }
}

/** Select saved board by app board id. Native reads BLE id/name from its DB and owns connect. */
export async function selectBoard(boardId: string): Promise<void> {
  if (E2E_ENABLED) {
    e2eFake.selectBoard(boardId)
    return
  }

  return native.selectBoard(boardId)
}

/** Stop native board session. GPS monitoring may continue independently. */
export async function stopBoard(): Promise<void> {
  if (E2E_ENABLED) {
    e2eFake.stopBoard()
    return
  }

  return native.stopBoard()
}

/** Stop all native work and remove app task. */
export function exitApp(): void {
  if (E2E_ENABLED) return
  native.exitApp()
}

/**
 * Run a native Board Probe of a BLE peripheral: connect, probe direct and CAN,
 * and return every transport confirmed by a valid Telemetry Sample. Runs before
 * a Board necessarily exists and tears down any live Board Session first.
 * Emits `onBoardProbeProgress` events while it runs.
 */
export async function probeBoardLink(bleId: string, probeId: string): Promise<BoardProbeResult> {
  if (E2E_ENABLED) {
    return e2eFake.probeBoardLink(bleId, probeId)
  }

  return native.probeBoardLink(bleId, probeId)
}

/** Cancel an in-flight native Board Probe if it still matches the operation id. */
export function cancelBoardProbe(probeId: string): void {
  if (E2E_ENABLED) return
  native.cancelBoardProbe(probeId)
}

/** Enable raw debug session recording for future native board sessions. */
export function setDebugRecordingEnabled(enabled: boolean): void {
  native.setDebugRecordingEnabled(enabled)
}

/** List locally retained raw BLE debug captures. */
export async function listDebugRecordings(): Promise<DebugRecording[]> {
  return native.listDebugRecordings()
}

/** List replay fixtures bundled into app assets from `shared/fixtures/`. */
export async function listBundledDebugFixtures(): Promise<DebugFixture[]> {
  return native.listBundledDebugFixtures()
}

/** Copy a raw BLE debug capture to cache storage for sharing. */
export async function exportDebugRecording(name: string): Promise<DatabaseBackupResult> {
  return native.exportDebugRecording(name)
}

/** Permanently delete a locally retained raw BLE debug capture. */
export async function deleteDebugRecording(name: string): Promise<void> {
  return native.deleteDebugRecording(name)
}

/**
 * Dev mode: replay a Debug Recording through the real native session stack under a synthetic
 * `replay:<name>` board id (ADR 0024). Ends like a disconnect when the recording runs out.
 *
 * Defaults to 1× — the recording plays back exactly as the ride happened, which is what the Replay
 * UI wants. Pass a warmup to trade that off for a session that starts with its live charts already
 * filled: `warmupMs` of the recording is delivered `warmupSpeed` times faster than real time before
 * playback settles to 1×.
 */
export async function startDebugReplay(name: string, options?: DebugReplayOptions): Promise<void> {
  return native.startDebugReplay(name, options ?? null)
}

/** Dev mode: stop an active Debug Recording replay session (normal disconnect). */
export async function stopDebugReplay(): Promise<void> {
  return native.stopDebugReplay()
}

/** Report a JS view-layer failure. Native failures are reported at their own operation boundary. */
export function reportUiError(
  message: string,
  source?: string | null,
  stack?: string | null,
): void {
  native.reportUiError(message, source ?? null, stack ?? null)
}

/** Send a manual native diagnostic event from development tooling. */
export function reportDiagnosticTest(): DiagnosticStatus {
  return native.reportDiagnosticTest()
}

/** Read native diagnostic reporter state for development tooling. */
export function getDiagnosticStatus(): DiagnosticStatus {
  return native.getDiagnosticStatus()
}

/** Read native-owned live state. UI should mirror this, not invent connection state. */
export function getLiveState(): LiveStateEvent {
  if (E2E_ENABLED) return e2eFake.getLiveState(native.getLiveState())
  return native.getLiveState()
}

/**
 * Read the process's current App Status. `null` while no successful fetch has landed — the app
 * fails open and behaves as `current`.
 */
export function getAppStatus(): AppStatus | null {
  if (E2E_ENABLED) return null
  return native.getAppStatus()
}

/**
 * Read the process's current forecast. `null` until a GPS Fix has produced one — nothing on this
 * side can ask for a fetch, because the position that would drive it is native's to begin with.
 */
export function getWeather(): Weather | null {
  if (E2E_ENABLED) return null
  return native.getWeather()
}

/**
 * Refetch the forecast where the last one was fetched — the rider asking for fresh weather. Fire and
 * forget: the result lands on `onWeather` like every other refresh, and a call before the first
 * forecast exists does nothing.
 */
export function refreshWeather(): void {
  if (E2E_ENABLED) return
  native.refreshWeather()
}

export async function provisionDeviceCredential(
  serverUrl: string,
  deviceToken: string,
  accountId: string,
): Promise<DeviceCredentialStatus> {
  return native.provisionDeviceCredential(serverUrl, deviceToken, accountId)
}

export function getDeviceCredentialState(): DeviceCredentialStatus {
  return native.getDeviceCredentialState()
}

export async function revokeDeviceCredential(): Promise<void> {
  return native.revokeDeviceCredential()
}

export function clearDeviceCredential(): void {
  native.clearDeviceCredential()
}

/**
 * Open the stable Vescape download route for this platform. Native owns platform selection.
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `openAppUpdate`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `openAppUpdate`
 */
export function openAppUpdate(): void {
  // Never bounce an E2E run out to the browser — App Status is stubbed off in E2E anyway.
  if (E2E_ENABLED) return
  native.openAppUpdate()
}

/** Read remote tilt without reseeding native telemetry into the JS history buffer. */
export function getRemoteTiltState(): RemoteTiltState | null {
  if (E2E_ENABLED) return null
  return native.getRemoteTiltState()
}

/** Persist native auto-connect target. Native can use this while JS is frozen. */
export function setSelectedBoard(boardId: string | null): void {
  if (E2E_ENABLED) {
    e2eFake.setSelectedBoard(boardId)
    return
  }

  native.setSelectedBoard(boardId)
}

export async function getTelemetryHistory(
  options: TelemetryHistoryOptions = {},
): Promise<TelemetryMinuteBucket[]> {
  if (E2E_ENABLED) {
    return e2eFake.getTelemetryHistory(options)
  }
  return native.getTelemetryHistory(options)
}

export async function getTelemetrySamples(options: {
  fromMs: number
  toMs: number
  deviceId?: string
  limit?: number
}): Promise<TelemetrySample[]> {
  if (E2E_ENABLED) {
    const range = await e2eFake.getHistoryRange(options)
    return decodeBoardSamples(range)
  }
  return native.getTelemetrySamples(options)
}

export async function getHistoryRange(options: {
  fromMs: number
  toMs: number
  deviceId?: string
  limit?: number
}): Promise<HistoryRange> {
  const range: NativeHistoryRange = E2E_ENABLED
    ? e2eFake.getHistoryRange(options)
    : await native.getHistoryRange(options)
  return {
    boardSamples: decodeBoardSamples(range),
    chartSamples:
      range.chartColumns && range.chartCount != null
        ? decodeBoardSamples(range, range.chartColumns, range.chartCount)
        : decodeBoardSamples(range),
    gpsSamples: range.gpsSamples,
    markers: range.markers,
    exclusions: range.exclusions,
  }
}

export async function getTelemetrySummary(): Promise<TelemetrySummary> {
  if (E2E_ENABLED) {
    return e2eFake.getTelemetrySummary()
  }
  return native.getTelemetrySummary()
}

export async function getFavorites(): Promise<Favorite[]> {
  return native.getFavorites()
}

/** Pin a time range as a Favorite. Native mints the id, the timestamps and the summary stats. */
export async function createFavorite(options: CreateFavoriteOptions): Promise<Favorite> {
  return native.createFavorite(options)
}

/** Update a Favorite in place, preserving identity and media while native recomputes its summary. */
export async function updateFavorite(
  id: string,
  options: UpdateFavoriteOptions,
): Promise<Favorite> {
  return native.updateFavorite(id, options)
}

/** Unpin a Favorite. Its telemetry stays and becomes normally deletable (ADR 0029). */
export async function deleteFavorite(id: string): Promise<boolean> {
  return native.deleteFavorite(id)
}

/** List native-manifested Favorite Media after filesystem reconciliation. */
export async function getFavoriteMedia(favoriteId: string): Promise<FavoriteMedia[]> {
  return native.getFavoriteMedia(favoriteId)
}

/** Import picker bytes into canonical Favorite-owned app storage. */
export async function importFavoriteMedia(
  options: ImportFavoriteMediaOptions,
): Promise<FavoriteMedia> {
  return native.importFavoriteMedia(options)
}

export async function getDiagnosticEvents(
  options: DiagnosticEventOptions = {},
): Promise<LocalDiagnosticEvent[]> {
  return native.getDiagnosticEvents(options)
}

export async function clearDiagnosticEvents(): Promise<void> {
  return native.clearDiagnosticEvents()
}

// ---------------------------------------------------------------------------
// Board Warnings
// ---------------------------------------------------------------------------

/** Pull the full current Board Warning list across all boards — used for the foreground catch-up. */
export async function getBoardWarnings(): Promise<BoardWarning[]> {
  return native.getBoardWarnings()
}

/** Manually clear a single Board Warning. A still-true condition simply re-fires on next evaluation. */
export async function clearBoardWarning(boardId: string, kind: string): Promise<void> {
  return native.clearBoardWarning(boardId, kind)
}

/** Manually clear every Board Warning for a board. Still-true conditions re-fire on next evaluation. */
export async function clearAllBoardWarnings(boardId: string): Promise<void> {
  return native.clearAllBoardWarnings(boardId)
}

/** Dev-only: inject a fake Board Warning to exercise the fire → persist → emit pipe without a detector. */
export async function devInjectBoardWarning(
  boardId: string,
  kind: string,
  severity: BoardWarningSeverity,
  payloadJson: string,
): Promise<void> {
  return native.devInjectBoardWarning(boardId, kind, severity, payloadJson)
}

/** Dev-only: report a clean evaluation for a kind (evaluated with data, condition gone), auto-clearing it. */
export async function devReportCleanBoardWarning(boardId: string, kind: string): Promise<void> {
  return native.devReportCleanBoardWarning(boardId, kind)
}

export async function getDatabaseSizeBytes(): Promise<number> {
  return native.getDatabaseSizeBytes()
}

export async function backupDatabase(): Promise<DatabaseBackupResult> {
  return native.backupDatabase()
}

export async function restoreDatabase(uri: string): Promise<void> {
  return native.restoreDatabase(uri)
}

export async function getRefloatConfigSnapshot(): Promise<RefloatConfigSnapshot> {
  return native.getRefloatConfigSnapshot()
}

/**
 * Stream Floaty's temporary remote-tilt input. `value` is the 0..255 slider
 * (128 = neutral). Requires `inputtilt_remote_type` = UART in the board config.
 */
export async function setRemoteTilt(value: number): Promise<boolean> {
  if (E2E_ENABLED) return true
  return native.setRemoteTilt(value)
}

/** Lock the held tilt indefinitely (lock band) until cancelled. */
export async function lockRemoteTilt(value: number): Promise<boolean> {
  if (E2E_ENABLED) return true
  return native.lockRemoteTilt(value)
}

/**
 * Release the pad: ease `value` (0..255) linearly back to neutral over
 * `durationMs`, then stop. A zero duration snaps straight to neutral.
 */
export async function releaseRemoteTilt(value: number, durationMs: number): Promise<boolean> {
  if (E2E_ENABLED) return true
  return native.releaseRemoteTilt(value, durationMs)
}

/** Stop streaming tilt and snap the board back to neutral. */
export async function stopRemoteTilt(): Promise<boolean> {
  if (E2E_ENABLED) return true
  return native.stopRemoteTilt()
}

/**
 * Hold a Board Move input until {@link stopBoardMove}. `input` is `-127..127`:
 * positive moves the board forward, negative backward, `0` stops. Unlike Remote
 * Tilt this drives motor output, and the firmware honours it only while the
 * board is disengaged (ready). Native repeats the input on a tick, because the
 * board drops the request after ~1s of silence.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescProtocol.kt `buildBoardMoveCommand`
 * @parity /modules/vescape-core/ios/protocol/VescProtocol.swift `buildBoardMoveCommand`
 */
export async function startBoardMove(input: number): Promise<boolean> {
  if (E2E_ENABLED) return true
  return native.startBoardMove(input)
}

/** Stop moving and send a neutral input so the board halts immediately. */
export async function stopBoardMove(): Promise<boolean> {
  if (E2E_ENABLED) return true
  return native.stopBoardMove()
}

export async function getTuneProfiles(
  boardId: string,
  refloatBaseVersion?: string | null,
): Promise<TuneProfile[]> {
  return native.getTuneProfiles(boardId, refloatBaseVersion)
}

export async function getTuneProfile(profileId: string): Promise<TuneProfile | null> {
  return native.getTuneProfile(profileId)
}

export async function createProfile(
  boardId: string,
  name: string,
  icon: string,
  color: string,
  fields: Record<string, TuneProfileFieldValue>,
  refloatBaseVersion: string,
): Promise<TuneProfile> {
  return native.createProfile(boardId, name, icon, color, fields, refloatBaseVersion)
}

export async function renameProfile(
  profileId: string,
  name: string,
  icon: string,
  color: string,
): Promise<TuneProfile> {
  return native.renameProfile(profileId, name, icon, color)
}

export async function deleteProfile(profileId: string): Promise<void> {
  return native.deleteProfile(profileId)
}

export async function getProfileHistory(profileId: string): Promise<TuneHistoryEntry[]> {
  return native.getProfileHistory(profileId)
}

export async function rollbackProfile(
  profileId: string,
  historyEntryId: number,
): Promise<TuneProfile> {
  return native.rollbackProfile(profileId, historyEntryId)
}

export async function copyProfileToBoard(
  profileId: string,
  targetBoardId: string,
  newName: string,
): Promise<TuneProfile> {
  return native.copyProfileToBoard(profileId, targetBoardId, newName)
}

export async function saveProfile(
  profileId: string,
  fields: Record<string, TuneProfileFieldValue>,
): Promise<TuneProfile> {
  return native.saveProfile(profileId, fields)
}

export async function pushProfileToBoard(profileId: string): Promise<RefloatConfigSnapshot> {
  return native.pushProfileToBoard(profileId)
}

export async function getTotalProfileStats(): Promise<ProfileStats> {
  return native.getTotalProfileStats()
}

export async function getMonthlyProfileStats(options: ProfileStatsMonth): Promise<ProfileStats> {
  return native.getMonthlyProfileStats(options)
}

export async function getProfileStatMonths(): Promise<ProfileStatsMonth[]> {
  return native.getProfileStatMonths()
}

export async function rebuildTelemetryBuckets(): Promise<number> {
  return native.rebuildTelemetryBuckets()
}

export async function deleteTelemetryBefore(beforeMs: number): Promise<number> {
  return native.deleteTelemetryBefore(beforeMs)
}

export async function deleteTelemetryRange(options: TelemetryDeleteRangeOptions): Promise<number> {
  return native.deleteTelemetryRange(options)
}

export async function clearTelemetryHistory(): Promise<void> {
  if (E2E_ENABLED) {
    e2eFake.clearTelemetryHistory()
    return
  }
  return native.clearTelemetryHistory()
}

export async function getBoards(): Promise<Board[]> {
  if (E2E_ENABLED) {
    return e2eFake.getBoards()
  }
  return native.getBoards()
}

export async function upsertBoard(board: Board): Promise<void> {
  if (E2E_ENABLED) {
    e2eFake.upsertBoard(board)
    return
  }
  return native.upsertBoard(board)
}

export async function deleteBoard(id: string): Promise<void> {
  return native.deleteBoard(id)
}

export async function getAlertRules(boardId: string): Promise<AlertRule[]> {
  return native.getAlertRules(boardId)
}

export async function upsertAlertRule(rule: AlertRule): Promise<void> {
  return native.upsertAlertRule(rule)
}

export async function setAlertRuleEnabled(
  boardId: string,
  id: string,
  enabled: boolean,
): Promise<void> {
  return native.setAlertRuleEnabled(boardId, id, enabled)
}

export async function deleteAlertRule(boardId: string, id: string): Promise<void> {
  return native.deleteAlertRule(boardId, id)
}

export async function getPrivacyZones(): Promise<PrivacyZone[]> {
  if (E2E_ENABLED) return e2eFake.getPrivacyZones()
  return native.getPrivacyZones()
}

export async function upsertPrivacyZone(zone: PrivacyZone): Promise<void> {
  if (E2E_ENABLED) {
    e2eFake.upsertPrivacyZone(zone)
    return
  }
  return native.upsertPrivacyZone(zone)
}

export async function setPrivacyZoneEnabled(id: string, enabled: boolean): Promise<void> {
  if (E2E_ENABLED) {
    e2eFake.setPrivacyZoneEnabled(id, enabled)
    return
  }
  return native.setPrivacyZoneEnabled(id, enabled)
}

export async function deletePrivacyZone(id: string): Promise<void> {
  if (E2E_ENABLED) {
    e2eFake.deletePrivacyZone(id)
    return
  }
  return native.deletePrivacyZone(id)
}

/**
 * Map Points nearest to a coordinate, newest server truth. Reads need no account; a stored Device
 * Token additionally resolves `ownedByMe` and `myReaction`.
 */
export async function getNearbyMapPoints(
  latitude: number,
  longitude: number,
  radiusMeters: number,
): Promise<NearbyMapPoints> {
  return native.getNearbyMapPoints(latitude, longitude, radiusMeters)
}

export async function createMapPoint(values: MapPointValues): Promise<MapPoint> {
  return native.createMapPoint(values)
}

export async function updateMapPoint(id: string, patch: MapPointPatch): Promise<MapPoint> {
  return native.updateMapPoint(id, patch)
}

export async function deleteMapPoint(id: string): Promise<void> {
  return native.deleteMapPoint(id)
}

/** `null` removes the reaction. The server keeps at most one per Account and Map Point. */
export async function setMapPointReaction(
  id: string,
  reaction: MapPointReaction | null,
): Promise<void> {
  return native.setMapPointReaction(id, reaction)
}

/** Personal direction target, kept natively so Group Ride presence reads it without JS. */
export async function setDirectionPoint(
  latitude: number | null,
  longitude: number | null,
): Promise<void> {
  return native.setDirectionPoint(latitude, longitude)
}

/**
 * Asks native to compute the Navigation again, from the rider's current position to the Direction
 * Point they already have. A no-op when no Direction Point is set.
 *
 * The rider's own action, and the only way a Navigation is ever replaced: nothing in the app may
 * call this automatically, on a timer, on reconnect or on a new fix. A path that appears mid-ride
 * without being asked for is exactly what Navigation is designed not to do.
 *
 * A request that finds no path leaves a drawn one in place — asking for a better path never costs
 * the rider the one they had.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `recomputeNavigation`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `recomputeNavigation`
 */
export async function recomputeNavigation(): Promise<void> {
  return native.recomputeNavigation()
}

/**
 * Remembers `profile` as the rider's Navigation Profile and recomputes the path under it. The
 * choice sticks natively and becomes the default for the next Navigation, so nothing on this side
 * has to carry it between rides.
 *
 * Like `recomputeNavigation`, only ever called from a rider's tap.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setNavigationProfile`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `setNavigationProfile`
 */
export async function setNavigationProfile(profile: NavigationProfile): Promise<void> {
  return native.setNavigationProfile(profile)
}

export async function getSettings(): Promise<AppSettings> {
  if (E2E_ENABLED) {
    return e2eFake.getSettings()
  }
  return native.getSettings()
}

/**
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `refreshLegalPolicy`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `refreshLegalPolicy`
 */
export async function refreshLegalPolicy(): Promise<void> {
  if (E2E_ENABLED) return
  return native.refreshLegalPolicy()
}

/**
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `setLegalMode`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setLegalMode`
 */
export async function setLegalMode(boardId: string, enabled: boolean): Promise<void> {
  if (E2E_ENABLED) {
    e2eFake.setLegalMode(boardId, enabled)
    return
  }
  return native.setLegalMode(boardId, enabled)
}

export async function updateSetting(
  key: string,
  value: number | boolean | string | string[] | Record<string, unknown> | null,
): Promise<void> {
  if (E2E_ENABLED) {
    e2eFake.updateSetting(key, value)
    return
  }
  return native.updateSetting(key, value)
}

export async function setCompanionPresenceEnabled(enabled: boolean): Promise<void> {
  if (E2E_ENABLED) {
    e2eFake.updateSetting('companionPresenceEnabled', enabled)
    return
  }
  return native.setCompanionPresenceEnabled(enabled)
}

export async function getCompanionPresenceBoards(): Promise<CompanionPresenceBoard[]> {
  if (E2E_ENABLED) return e2eFake.getCompanionPresenceBoards()
  return native.getCompanionPresenceBoards()
}

export async function addCompanionPresenceBoard(boardId: string): Promise<void> {
  if (E2E_ENABLED) return e2eFake.addCompanionPresenceBoard(boardId)
  return native.addCompanionPresenceBoard(boardId)
}

export async function removeCompanionPresenceBoard(boardId: string): Promise<void> {
  if (E2E_ENABLED) return e2eFake.removeCompanionPresenceBoard(boardId)
  return native.removeCompanionPresenceBoard(boardId)
}

export function seedE2EData(flow: string): void {
  if (E2E_ENABLED) {
    e2eFake.seedE2EData(flow)
  }
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

/**
 * Discovery is a pair: `scan()` emits into `e2eFake`'s listener set, so a build that fakes the scan
 * has to subscribe there too. Splitting only the emit side leaves JS listening to the native
 * emitter for advertisements nothing is sending — the scan screen simply stays empty.
 */
export function addDeviceListener(cb: (event: DeviceFoundEvent) => void): EventSubscription {
  if (FAKE_SCAN) {
    return e2eFake.addDeviceListener(cb)
  }

  return emitter.addListener('onDevice', cb)
}

export function addErrorListener(cb: (event: ErrorEvent) => void): EventSubscription {
  return emitter.addListener('onError', cb)
}

export function addAppDataChangedListener(
  cb: (event: AppDataChangedEvent) => void,
): EventSubscription {
  return emitter.addListener('onAppDataChanged', cb)
}

export function addBoardWarningsListener(
  cb: (event: BoardWarningsEvent) => void,
): EventSubscription {
  return emitter.addListener('onBoardWarnings', cb)
}

export function addAppStatusListener(cb: (event: AppStatusEvent) => void): EventSubscription {
  return emitter.addListener('onAppStatus', cb)
}

export function addWeatherListener(cb: (event: WeatherEvent) => void): EventSubscription {
  return emitter.addListener('onWeather', cb)
}

export function addNavigationListener(cb: (event: NavigationEvent) => void): EventSubscription {
  return emitter.addListener('onNavigation', cb)
}

export function addRouteProgressListener(
  cb: (event: RouteProgressEvent) => void,
): EventSubscription {
  return emitter.addListener('onRouteProgress', cb)
}

export function addLiveStateListener(cb: (event: LiveStateEvent) => void): EventSubscription {
  if (E2E_ENABLED) {
    return e2eFake.addLiveStateListener(cb)
  }

  return emitter.addListener('onLiveState', cb)
}

export function addLiveTickListener(cb: (event: TelemetryEvent) => void): EventSubscription {
  if (E2E_ENABLED) {
    return e2eFake.addLiveTickListener(cb)
  }

  return emitter.addListener('onLiveTick', cb)
}

export function addLiveSeriesListener(cb: (event: LiveSeriesEvent) => void): EventSubscription {
  if (E2E_ENABLED) {
    return e2eFake.addLiveSeriesListener(cb)
  }

  return emitter.addListener('onLiveSeries', cb)
}

export function addFocusedSeriesListener(
  cb: (event: FocusedSeriesEvent) => void,
): EventSubscription {
  return emitter.addListener('onFocusedSeries', cb)
}

export function addTelemetryHistoryListener(
  cb: (event: TelemetryHistoryEvent) => void,
): EventSubscription {
  if (E2E_ENABLED) {
    return e2eFake.addTelemetryHistoryListener(cb)
  }

  return emitter.addListener('onTelemetryHistory', cb)
}

export function addBmsListener(cb: (event: BmsEvent) => void): EventSubscription {
  return emitter.addListener('onBms', cb)
}

export function addBmsSeriesListener(cb: (event: BmsSeriesUpdate) => void): EventSubscription {
  return emitter.addListener('onBmsSeries', (event) => {
    cb({
      mode: event.mode,
      generation: event.generation,
      windowMs: event.windowMs,
      frames: decodeBmsSeriesFrames(event),
    })
  })
}

export function addLocationListener(cb: (event: LocationEvent) => void): EventSubscription {
  return emitter.addListener('onLocation', cb)
}

/**
 * Compass readings replayed from a Debug Recording, in place of the phone's own magnetometer.
 *
 * The sensor is read in JS, so native can neither observe it nor apply it — it only stores and
 * replays it. A replay feeds these back in at the sensor boundary so every compass-driven feature
 * runs its real code path against the rotation the rider's phone actually measured.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `onReplayHeading`
 * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `onReplayHeading`
 */
export function addReplayPhoneHeadingListener(
  cb: (event: { headingDeg: number }) => void,
): EventSubscription {
  return emitter.addListener('onReplayPhoneHeading', cb)
}

/**
 * Offer a compass reading to whatever Debug Recording is running; native drops it when nothing is
 * recording. Safe (and intended) to call unconditionally while the map's heading layer is live.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `recordPhoneHeading`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `recordPhoneHeading`
 */
export function recordPhoneHeading(headingDeg: number): void {
  native.recordPhoneHeading(headingDeg)
}

/**
 * Sync the settled phone-map viewport scale to the Android Wear route. iOS accepts this as a no-op
 * because the Wear Mirror is Android-only.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setWatchRouteSpanM`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `setWatchRouteSpanM`
 */
export function setWatchRouteSpanM(spanM: number | null): void {
  native.setWatchRouteSpanM(spanM)
}

export function addTelemetryRebuildProgressListener(
  cb: (event: TelemetryRebuildProgressEvent) => void,
): EventSubscription {
  return emitter.addListener('onTelemetryRebuildProgress', cb)
}

export function addBoardProbeProgressListener(
  cb: (event: BoardProbeProgressEvent) => void,
): EventSubscription {
  if (E2E_ENABLED) {
    return e2eFake.addBoardProbeProgressListener(cb)
  }

  return emitter.addListener('onBoardProbeProgress', cb)
}

export function addGroupRideConnectionListener(
  cb: (event: GroupRideConnectionEvent) => void,
): EventSubscription {
  return emitter.addListener('onGroupRideConnection', cb)
}

export function addGroupRideSnapshotListener(
  cb: (event: GroupRideSnapshotEvent) => void,
): EventSubscription {
  return emitter.addListener('onGroupRideSnapshot', cb)
}

export function addGroupRideCreatedListener(
  cb: (event: GroupRideCreatedEvent) => void,
): EventSubscription {
  return emitter.addListener('onGroupRideCreated', cb)
}

export function addGroupRideUpdatedListener(
  cb: (event: GroupRideUpdatedEvent) => void,
): EventSubscription {
  return emitter.addListener('onGroupRideUpdated', cb)
}

export function addGroupRideEndedListener(
  cb: (event: GroupRideEndedEvent) => void,
): EventSubscription {
  return emitter.addListener('onGroupRideEnded', cb)
}

export function addGroupRideJoinedListener(
  cb: (event: GroupRideJoinedEvent) => void,
): EventSubscription {
  return emitter.addListener('onGroupRideJoined', cb)
}

export function addGroupRideRosterListener(
  cb: (event: GroupRideRosterEvent) => void,
): EventSubscription {
  return emitter.addListener('onGroupRideRoster', cb)
}

export function addGroupRideErrorListener(
  cb: (event: GroupRideErrorEvent) => void,
): EventSubscription {
  return emitter.addListener('onGroupRideError', cb)
}
