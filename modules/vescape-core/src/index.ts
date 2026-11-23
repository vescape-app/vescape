/**
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt
 */

import { requireNativeModule, type EventSubscription } from 'expo-modules-core'

import { e2eFake } from './e2eFake'
import { decodeBmsSeriesFrames, type BmsSeriesFrame } from './bmsSeries'

export type { BmsSeriesFrame } from './bmsSeries'

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
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryDiscovery.kt
 * @parity /modules/vescape-core/ios/accessory/AccessoryDiscovery.swift
 */
export interface AccessoryDeviceEvent {
  id: string
  name: string | null
  rssi: number
}

export interface AccessoryScanErrorEvent {
  error: 'bluetooth-unavailable' | 'scan-failed'
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryProtocol.kt `TYPE_GROUND_CLEARANCE`
 * @parity /modules/vescape-core/ios/accessory/AccessoryProtocol.swift `typeGroundClearance`
 */
export type AccessoryCapabilityType = 'ground_clearance' | 'brake_light'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryProtocol.kt `AccessoryCompatibility`
 * @parity /modules/vescape-core/ios/accessory/AccessoryProtocol.swift `AccessoryCompatibility`
 */
export type AccessoryCompatibility =
  'supported' | 'unsupported-version' | 'unsupported-capabilities'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryProtocol.kt `AccessoryCapability`
 * @parity /modules/vescape-core/ios/accessory/AccessoryProtocol.swift `AccessoryCapability`
 */
export interface AccessoryCapability {
  id: string
  type: AccessoryCapabilityType | (string & {})
  supported: boolean
  unit: string | null
  rangeMin: number | null
  rangeMax: number | null
  ratesHz: number[]
  /**
   * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySessionManager.kt `describeCapability`
   * @parity /modules/vescape-core/ios/accessory/AccessorySessionController.swift `describeCapability`
   */
  enabled?: boolean
  /**
   * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySessionManager.kt `describeCapability`
   * @parity /modules/vescape-core/ios/accessory/AccessorySessionController.swift `describeCapability`
   */
  samplingRateHz?: number | null
  /**
   * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySessionManager.kt `describeCapability`
   * @parity /modules/vescape-core/ios/accessory/AccessorySessionController.swift `describeCapability`
   */
  selectedRateHz?: number | null
  calibration?: GroundClearanceCalibration | null
  measuring?: boolean
  /**
   * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/BrakeLight.kt `describe`
   * @parity /modules/vescape-core/ios/accessory/BrakeLight.swift `describe`
   */
  brakeLight?: BrakeLightSettings
  lightMode?: BrakeLightMode | null
  lightPreview?: BrakeLightMode | null
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/GroundClearance.kt `GroundClearanceDirection`
 * @parity /modules/vescape-core/ios/accessory/GroundClearance.swift `GroundClearanceDirection`
 */
export type GroundClearanceDirection = 'nose' | 'tail'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/BrakeLight.kt `BrakeLightSettings`
 * @parity /modules/vescape-core/ios/accessory/BrakeLight.swift `BrakeLightSettings`
 */
export interface BrakeLightSettings {
  sensitivity: number
  parked: 'off' | 'glow'
}
/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/BrakeLight.kt `MODES`
 * @parity /modules/vescape-core/ios/accessory/BrakeLight.swift `modes`
 */
export type BrakeLightMode = 'riding' | 'braking' | 'hard_braking' | 'not_riding'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/GroundClearance.kt `GroundClearanceProblem`
 * @parity /modules/vescape-core/ios/accessory/GroundClearance.swift `GroundClearanceProblem`
 */
export type GroundClearanceProblem =
  | 'not-a-number'
  | 'near-not-below-far'
  | 'unknown-direction'
  | 'strength-out-of-bounds'
  | 'outside-declared-range'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/GroundClearance.kt `GroundClearanceCalibration`
 * @parity /modules/vescape-core/ios/accessory/GroundClearance.swift `GroundClearanceCalibration`
 */
export interface GroundClearanceCalibration {
  nearCm: number
  farCm: number
  direction: GroundClearanceDirection | (string & {})
  strengthPercent: number
  problem: GroundClearanceProblem | null
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/GroundClearance.kt `GroundClearanceRelease`
 * @parity /modules/vescape-core/ios/accessory/GroundClearance.swift `GroundClearanceRelease`
 */
export type GroundClearanceRelease =
  | 'disabled'
  | 'not-riding'
  | 'no-link'
  | 'not-calibrated'
  | 'stale'
  | 'out-of-range'
  | 'sensor-error'
  | 'board-untrusted'
  | 'board-stale'
  | 'contested'
  | 'board-move'
  | 'manual-tilt'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `groundClearanceTiltState`
 * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `groundClearanceTiltState`
 */
export interface GroundClearanceTiltState {
  bound: boolean
  driving: boolean
  release: GroundClearanceRelease | null
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySession.kt `AccessoryReadingStatus`
 * @parity /modules/vescape-core/ios/accessory/AccessorySession.swift `AccessoryReadingStatus`
 */
export type AccessoryReadingStatus = 'ok' | 'out_of_range' | 'error'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/ClearancePreviewLog.kt
 * @parity /modules/vescape-core/ios/accessory/ClearancePreviewLog.swift
 */
export interface ClearancePreviewDiagnostics {
  segments: number[][]
  deliveredHz: number
  dropped: number
  invalid: number
  samples: number
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySessionManager.kt `onReading`
 * @parity /modules/vescape-core/ios/accessory/AccessorySessionController.swift `onReading`
 */

export interface AccessoryReadingEvent {
  /**
   * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/GroundClearance.kt `acceptReading`
   * @parity /modules/vescape-core/ios/accessory/GroundClearance.swift `acceptReading`
   */
  tiltPreviewPercent?: number | null
  diagnostics?: ClearancePreviewDiagnostics | null
  accessoryId: string
  capabilityId: string
  seq: number
  sampleTimeMs: number
  status: AccessoryReadingStatus
  valueCm: number | null
  staleAfterMs: number
}

export interface GroundClearanceSaveResult {
  saved: boolean
  problem: GroundClearanceProblem | 'unknown-capability' | 'storage-unavailable' | null
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryProtocol.kt `AccessoryManifest`
 * @parity /modules/vescape-core/ios/accessory/AccessoryProtocol.swift `AccessoryManifest`
 */
export interface AccessoryManifest {
  accessoryId: string
  name: string
  firmwareVersion: string
  protocolVersion: number | null
  supportedVersions: number[]
  compatibility: AccessoryCompatibility
  capabilities: AccessoryCapability[]
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryProtocol.kt `AccessoryHandshakeError`
 * @parity /modules/vescape-core/ios/accessory/AccessoryProtocol.swift `AccessoryHandshakeError`
 */
export type AccessoryInspectionError =
  | 'malformed'
  | 'invalid'
  | 'session-mismatch'
  | 'oversized'
  | 'invalid-utf8'
  | 'bluetooth-unavailable'
  | 'connect-failed'
  | 'service-missing'
  | 'write-failed'
  | 'timeout'
  | 'cancelled'
  | 'busy'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryDiscovery.kt `payload`
 * @parity /modules/vescape-core/ios/accessory/AccessoryDiscovery.swift `payload`
 */
export interface AccessoryInspection {
  deviceId: string
  advertisedName: string | null
  manifest: AccessoryManifest | null
  error: AccessoryInspectionError | null
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryLink.kt `AccessoryLinkPhase`
 * @parity /modules/vescape-core/ios/accessory/AccessoryLink.swift `AccessoryLinkPhase`
 */
export type AccessoryLinkPhase =
  'idle' | 'connecting' | 'handshaking' | 'connected' | 'unavailable' | 'incompatible'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySessionManager.kt `buildSnapshot`
 * @parity /modules/vescape-core/ios/accessory/AccessorySessionController.swift `snapshot`
 */
export interface SavedAccessory {
  accessoryId: string
  name: string
  firmwareVersion: string
  protocolVersion: number | null
  deviceId: string | null
  enrolledAt: number
  lastConnectedAt: number | null
  phase: AccessoryLinkPhase
  error: string | null
  compatibility: AccessoryCompatibility | null
  capabilities: AccessoryCapability[]
  capabilitiesChanged: boolean
  leaseHeldMs: number | null
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySessionManager.kt `publish`
 * @parity /modules/vescape-core/ios/accessory/AccessorySessionController.swift `publish`
 */
export interface AccessoryStateEvent {
  accessories: SavedAccessory[]
}

export interface AccessoryEnrollment {
  accessoryId: string | null
  error: AccessoryInspectionError | 'storage-unavailable' | null
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescTelemetryModels.kt `LocationSnapshot`
 * @parity /modules/vescape-core/ios/telemetry/TelemetryPipeline.swift `TelemetryLocationCapture`
 */
export interface LocationEvent {
  latitude: number
  longitude: number
  speedMps: number | null
  bearingDeg: number | null
  courseDeg: number | null
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
  spec: string
  rangeDepth?: number | null
  firedAt: number
}

export type BoardTransport = 'direct' | number

export type BoardProbeOutcome = 'resolved' | 'needs-pick' | 'none'

export interface BoardCandidate {
  transport: BoardTransport
  hasBms: boolean
  vescFirmwareVersion?: string | null
  refloatVersion?: string | null
  refloatBaseVersion?: string | null
}

export interface BoardProbeResult {
  outcome: BoardProbeOutcome
  transport: BoardTransport | null
  candidates: BoardCandidate[]
}

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
  | 'session'
  | 'config'
  | 'motor-config'
  | 'completed'
  | 'failed'

export interface BoardProbeProgressEvent {
  probeId?: string
  step: BoardProbeStep
  elapsedMs: number
  transport?: BoardTransport
  canIds?: number[]
}

/**
 * @parity /modules/vescape-core/ios/runtime/BoardSession.swift `LinkIntegrity`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/runtime/BoardSession.kt `LinkIntegrity`
 */
export type LinkIntegrity = 'unknown' | 'checking' | 'trusted' | 'outdated' | 'mismatched'

export interface BoardLink {
  linkVersion?: 4
  bleId: string
  transport: BoardTransport
  hasBms?: boolean
  vescFirmwareVersion?: string
  refloatVersion?: string
  refloatBaseVersion?: string
}

export interface Board {
  id: string
  name: string
  description: string | null
  /**
   * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `normalizePersonalization`
   * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `normalizePersonalization`
   */
  personalization?: { railId: string; railColorId: string }
  createdAt: number
  deletedAt: number | null
  batteryConfig: BatteryConfig | null
  lastBattery?: LastBattery | null
  /**
   * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `normalizeStringList`
   * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `normalizeStringList`
   */
  dismissedWarnings?: string[]
  /**
   * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `composeBoard`
   * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `toMap`
   */
  ignoredConfigChangeFields?: string[]
  topSpeedKmh?: number
  alertPresetsOnboarded?: boolean
  /**
   * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `composeBoard`
   * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `toMap`
   */
  legalMode?: { enabled: boolean }
  link: BoardLink | null
}

export type BoardInput = Omit<Board, 'deletedAt'>

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `initialAlertRows`
 * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `initialAlertRows`
 */
export interface InitialBoardAlerts {
  presets: Partial<Record<AlertPresetMetric, string>>
  rules: AlertRule[]
}

export interface LastBattery {
  percent: number
  voltage: number | null
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

export type AlertSpec = string

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
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `alertTestRule`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `toAlertTestRule`
 */
export interface AlertTestRule {
  id: string
  controlId: string
  threshold: number
  thresholdMax: number | null
  spec: AlertSpec
  repeatEverySeconds: number | null
}

// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt `AlertRuleEntity`
// @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `AlertRule`
export interface AlertRule {
  boardId: string
  id: string
  controlId: string
  threshold: number
  thresholdMax: number | null
  thresholdRule?:
    | { kind: 'fixed' }
    | {
        kind: 'config-relative'
        fieldId: string
        thresholdOffset: number
        thresholdMaxOffset: number | null
      }
  enabled: boolean
  spec: AlertSpec
  createdAt: number
  repeatEverySeconds: number | null
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `ALERT_REPEAT_MIN_SECONDS`
 * @parity /modules/vescape-core/ios/alerts/AlertEngine.swift `alertRepeatMinSeconds`
 */
export const ALERT_REPEAT_MIN_SECONDS = 3

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `ALERT_BEEP_COUNT_RANGE`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `alertBeepCountRange`
 */
export const ALERT_BEEP_COUNT_RANGE = { min: 1, max: 5 } as const

export const ALERT_BEEP_COUNT_DEFAULT = 1

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
 * @parity /modules/vescape-core/ios/mappoints/MapPointApi.swift
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/mappoints/MapPointApi.kt
 */
export type MapPointCategory =
  'drop' | 'bonk' | 'nose_slide' | 'trail_entry' | 'viewpoint' | 'charging'

export type MapPointReaction = 'up' | 'down'

/**
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
  createdAt: string
  updatedAt: string
}

export interface NearbyMapPoints {
  items: MapPoint[]
  truncated: boolean
}

export interface MapPointValues {
  category: MapPointCategory
  latitude: number
  longitude: number
  name?: string | null
  description?: string | null
}

export type MapPointPatch = Partial<MapPointValues>

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/mappoints/MapPointApi.kt `MapPointApiException`
 * @parity /modules/vescape-core/ios/mappoints/MapPointApi.swift `MapPointApiError`
 */
export type MapPointErrorCode =
  | 'MAP_POINT_SIGN_IN_REQUIRED'
  | 'MAP_POINT_NOT_YOURS'
  | 'MAP_POINT_GONE'
  | 'MAP_POINT_REFUSED'
  | 'MAP_POINT_UNREACHABLE'

/**
 * @parity /modules/vescape-core/ios/riderprofiles/RiderProfileApi.swift
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/riderprofiles/RiderProfileApi.kt
 */
export interface RiderProfile {
  accountId: string
  nick: string
  nationality: string | null
}

/**
 * @parity /modules/vescape-core/ios/riderprofiles/RiderStatsSender.swift `fields`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/riderprofiles/RiderStatsSender.kt `FIELDS`
 * @parity /modules/vescape-core/ios/riderprofiles/RiderProfileApi.swift `stats`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/riderprofiles/RiderProfileApi.kt `stats`
 */
export interface RiderStats {
  distanceM: number | null
  rideCount: number
  rideTimeMs: number
  topSpeedKmh: number
  avgSpeedKmh: number
  longestRideM: number | null
  batteryUsedWh: number | null
  batteryRegenWh: number | null
}

/**
 * @parity /modules/vescape-core/ios/riderprofiles/RiderProfileApi.swift `detail`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/riderprofiles/RiderProfileApi.kt `detail`
 */
export interface RiderMonthStats extends RiderStats {
  month: string
}

/**
 * @parity /modules/vescape-core/ios/riderprofiles/RiderProfileApi.swift `detail`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/riderprofiles/RiderProfileApi.kt `detail`
 */
export interface RiderDetail extends RiderProfile {
  stats: { total: RiderStats | null; months: RiderMonthStats[] }
}

/**
 * @parity /modules/vescape-core/ios/riderprofiles/RiderProfileApi.swift `RiderProfileApiError`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/riderprofiles/RiderProfileApi.kt `RiderProfileApiException`
 */
export type RiderProfileErrorCode =
  | 'RIDER_PROFILE_SIGN_IN_REQUIRED'
  | 'RIDER_PROFILE_NICK_TAKEN'
  | 'RIDER_PROFILE_REFUSED'
  | 'RIDER_PROFILE_UNREACHABLE'

/**
 * @parity /modules/vescape-core/ios/riderprofiles/RiderProfileApi.swift `friends`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/riderprofiles/RiderProfileApi.kt `friends`
 */
export interface Friend extends RiderProfile {
  ridingNow: boolean
  lastOnlineAt: string | null
}

export interface FriendRequest extends RiderProfile {
  requestedAt: string
}

export interface Friends {
  friends: Friend[]
  incoming: FriendRequest[]
  outgoing: FriendRequest[]
}

export type FriendRequestStatus = 'requested' | 'friends'

export interface PublicTrackPoint {
  at: number
  lat: number
  lng: number
}

export interface RodeWithRider extends RiderProfile {
  startedAt: string
  endedAt: string
  track: PublicTrackPoint[]
}

/**
 * @parity /modules/vescape-core/ios/riderprofiles/RiderProfileApi.swift `rodeWith`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/riderprofiles/RiderProfileApi.kt `rodeWith`
 */
export interface RodeWithCrewRide {
  startedAt: string
  endedAt: string
  riders: RodeWithRider[]
}

export interface FriendRide {
  startedAt: string
  endedAt: string
}

/**
 * @parity /modules/vescape-core/ios/riderprofiles/RiderProfileApi.swift `friendRides`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/riderprofiles/RiderProfileApi.kt `friendRides`
 */
export interface FriendRidesPage {
  rides: FriendRide[]
  nextBefore: string | null
}

export interface TelemetryEvent {
  generation?: number
  remoteTilt?: RemoteTiltState | null
  location?: LocationEvent | null
  metricExclusions?: Record<string, boolean>
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
  pullRateHz: number | null
  lastPacketAt: number
  firedAlerts?: FiredAlert[]
  /**
   * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryPipeline.kt `ProcessedTelemetry`
   * @parity /modules/vescape-core/ios/telemetry/LiveSeriesEmitter.swift `LivePeaks`
   */
  speedPeak?: number | null
  dutyPeak?: number | null
}

export interface BmsEvent {
  capturedAt: number
  voltageTotal: number
  vCharge: number
  current: number
  currentIc: number
  ampHours: number
  wattHours: number
  soc: number | null
  soh: number | null
  cellVoltages: number[]
  balancing: boolean[]
  temps: number[]
  tempIc: number | null
  tempHum: number | null
  hum: number | null
  tempMaxCell: number | null
  canId: number | null
}

export interface BmsSeriesUpdate {
  mode: 'snapshot' | 'append'
  generation: number
  windowMs: number
  frames: BmsSeriesFrame[]
}

export type BoardPhase = SessionStatus
/**
 * @parity /modules/vescape-core/ios/location/GpsPhase.swift
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsPhase.kt
 */
export type GpsPhase = 'idle' | 'starting' | 'active' | 'error'
/**
 * @parity /modules/vescape-core/ios/location/GpsPowerMode.swift `GpsPowerMode`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsPowerMode.kt `GpsPowerMode`
 */
export type GpsPowerMode = 'off' | 'map' | 'ride'
export type ScanPhase = ScanStatus
/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RemoteTiltController.kt `RemoteTiltPhase`
 * @parity /modules/vescape-core/ios/RemoteTiltController.swift `RemoteTiltPhase`
 */
export type RemoteTiltPhase = 'idle' | 'holding' | 'decaying' | 'locked'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RemoteInputArbiter.kt `RemoteInputOwner`
 * @parity /modules/vescape-core/ios/RemoteInputArbiter.swift `RemoteInputOwner`
 */
export type RemoteTiltOwner = 'none' | 'manual' | 'sensor' | 'move'

export interface RemoteTiltDecay {
  elapsedMs: number
  totalMs: number
}

export interface RemoteTiltState {
  value: number
  phase: Exclude<RemoteTiltPhase, 'idle'>
  owner?: RemoteTiltOwner
  decay?: RemoteTiltDecay
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/LiveStateMapper.kt `buildLiveState`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `liveState`
 */
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
    remoteTilt: RemoteTiltState | null
  }
  gps: {
    phase: GpsPhase
    mode: GpsPowerMode
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
    /**
     * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/recording/RecordingStorageFailure.kt
     * @parity /modules/vescape-core/ios/recording/RecordingStorageFailure.swift
     */
    failure?: RecordingFailureState | null
  }
}

export interface RecordingFailureState {
  kind: 'write_failed' | 'storage_unavailable' | 'full_disk'
  storageUnavailable: boolean
}

export interface TelemetryHistoryOptions {
  fromMs?: number
  toMs?: number
  boardId?: string
  limit?: number
  cursorBeforeMs?: number
}

export interface DiagnosticEventOptions {
  fromMs?: number
  toMs?: number
  boardId?: string
  limit?: number
}

export interface TelemetryDeleteRangeOptions {
  fromMs: number
  toMs: number
  boardId?: string | null
}

export interface TelemetryMinuteBucket {
  id: string
  startAtMs: number
  endAtMs: number
  bucketStartMs: number
  boardId: string | null
  boardName: string
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
    | 'recording_stop'
  boundaryMessage?: string | null
  gapBeforeMs?: number | null
}

export interface TelemetrySample {
  id: number
  capturedAtMs: number
  boardId: string | null
  boardName: string
  speedKmh: number
  batteryVoltage: number
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
}

/**
 * @parity /modules/vescape-core/ios/telemetry/RideTrackProjection.swift `rideTrackGpsMaps`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/HistoryGpsProjection.kt `toSampleMap`
 */
export interface HistoryGpsSample {
  id: number
  capturedAtMs: number
  boardId: string | null
  boardName: string
  latitude: number
  longitude: number
  speedMps: number | null
  bearingDeg: number | null
  accuracyM: number | null
  altitudeM: number | null
  timestamp: number
  distanceFromPreviousM: number | null
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt `RECORDING_STOP_MARKER`
 * @parity /modules/vescape-core/ios/telemetry/RideHistoryRepository.swift `recordingStopMarker`
 */
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
    | 'recording_stop'
    | 'auto_pause'
  boardId: string | null
  message: string | null
  gapMs: number | null
}

export interface MetricExclusion {
  id: number
  boardId: string
  reason: string
  startMs: number
  endMs: number
  sampleCount: number
  metrics: Record<string, boolean>
}

export interface HistoryRange {
  boardSamples: TelemetrySample[]
  chartSamples: TelemetrySample[]
  gpsSamples: HistoryGpsSample[]
  markers: HistoryMarker[]
  exclusions: MetricExclusion[]
}

/**
 * @parity /modules/vescape-core/ios/telemetry/TelemetryRepository.swift `SAMPLE_COLUMN_COUNT`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `SAMPLE_COLUMN_COUNT`
 */
const SAMPLE_COLUMN_COUNT = 21

/**
 * @parity /modules/vescape-core/ios/telemetry/TelemetryRangePayload.swift `getRange`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `getRange`
 */
interface NativeHistoryRange {
  boardColumns: ArrayBuffer
  boardCount: number
  boardIds: (string | null)[]
  boardNames: string[]
  chartColumns?: ArrayBuffer
  chartCount?: number
  gpsSamples: HistoryGpsSample[]
  markers: HistoryMarker[]
  exclusions: MetricExclusion[]
}

const nullableLane = (value: number): number | null => (Number.isNaN(value) ? null : value)

/**
 * @parity /modules/vescape-core/ios/telemetry/TelemetryRepository.swift
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt
 */
function decodeBoardSamples(
  range: NativeHistoryRange,
  columns: ArrayBuffer = range.boardColumns,
  count: number = range.boardCount,
): TelemetrySample[] {
  const { boardIds, boardNames } = range
  if (!count || !columns) return []
  const lanes = new Float64Array(columns)
  const samples = new Array<TelemetrySample>(count)
  for (let i = 0; i < count; i++) {
    const o = i * SAMPLE_COLUMN_COUNT
    const boardIndex = lanes[o + 2]
    samples[i] = {
      id: lanes[o],
      capturedAtMs: lanes[o + 1],
      boardId: boardIds[boardIndex] ?? null,
      boardName: boardNames[boardIndex],
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
  columns: ArrayBuffer | Uint8Array
}

export interface TelemetrySummary {
  sampleCount: number
  gpsPointCount: number
  firstAtMs: number | null
  lastAtMs: number | null
  droppedPendingSamples: number
}

/**
 * @parity /modules/vescape-core/ios/telemetry/FavoriteStore.swift `Favorite`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt `FavoriteEntity`
 */
export interface Favorite {
  id: string
  boardId: string | null
  boardName: string | null
  name: string | null
  startMs: number
  endMs: number
  createdAtMs: number
  updatedAtMs: number
  sampleCount: number
  gpsPointCount: number
  distanceM: number | null
  movingDurationMs: number
  avgSpeedKmh: number
  maxSpeedKmh: number
  batteryUsedWh: number
  routePoints: RideRoutePoint[]
  weather: RideWeather | null
}

/**
 * @parity /modules/vescape-core/ios/telemetry/TelemetryRepository.swift `createFavorite`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `createFavorite`
 */
export interface CreateFavoriteOptions {
  startMs: number
  endMs: number
  boardId?: string
  name?: string
}

/**
 * @parity /modules/vescape-core/ios/telemetry/TelemetryRepository.swift `updateFavorite`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `updateFavorite`
 */
export interface UpdateFavoriteOptions {
  startMs: number
  endMs: number
  boardId?: string
  name: string | null
}

/**
 * @parity /modules/vescape-core/ios/telemetry/FavoriteMediaStore.swift `FavoriteMedia`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt `FavoriteMediaEntity`
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

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatConfigModels.kt `RefloatConfigErrorCode`
 * @parity /modules/vescape-core/ios/config/RefloatConfigModels.swift `RefloatConfigErrorCode`
 */
export type RefloatConfigErrorCode =
  | 'BOARD_NOT_CONNECTED'
  | 'LINK_NOT_TRUSTED'
  | 'CAN_ID_UNAVAILABLE'
  | 'GATT_NOT_WRITABLE'
  | 'CONFIG_REQUEST_IN_FLIGHT'
  | 'CONFIG_SCHEMA_TIMEOUT'
  | 'CONFIG_READ_TIMEOUT'
  | 'CONFIG_READ_FAILED'
  | 'CONFIG_WRITE_TIMEOUT'
  | 'CONFIG_WRITE_FAILED'
  | 'CONFIG_VERIFY_FAILED'
  | 'UNEXPECTED_CONFIG_RESPONSE'
  | 'UNSUPPORTED_SCHEMA'
  | 'CONFIG_DECODE_FAILED'
  | 'CONFIG_ENCODE_FAILED'
  | 'CONFIG_VALUE_INVALID'
  | 'BOARD_NOT_IDLE'
  | 'PROFILE_NOT_FOUND'
  | 'PROFILE_BOARD_MISMATCH'
  | 'UNSUPPORTED_PLATFORM'

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
  topSpeedRideId: string | null
  longestRideId: string | null
}

export interface ProfileStatsMonth {
  year: number
  month: number
}

export interface RideDay extends ProfileStatsMonth {
  day: number
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/ProfileStatsRepository.kt `readProfileStatsSnapshot`
 * @parity /modules/vescape-core/ios/telemetry/ProfileStatsRepository.swift `profileStatsSnapshot`
 */
export interface ProfileStatsSnapshot {
  total: ProfileStats
  monthly: ProfileStats
  months: ProfileStatsMonth[]
  selectedMonth: ProfileStatsMonth
  monthStats?: (ProfileStatsMonth & { stats: ProfileStats })[]
}

type ProfileStatsSnapshotOptions = Partial<ProfileStatsMonth> & { includeMonthStats?: boolean }

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideHistoryRepository.kt `RideRoutePoint`
 * @parity /modules/vescape-core/ios/telemetry/RideHistoryRepository.swift `RideRoutePoint`
 */
export interface RideRoutePoint {
  latitude: number
  longitude: number
  breakBefore?: boolean
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideHistoryRepository.kt `rideSessionMap`
 * @parity /modules/vescape-core/ios/telemetry/RideHistoryRepository.swift `rideSessionMap`
 */
export interface RideHistorySession {
  id: string
  boardId: string | null
  boardName: string
  startAtMs: number
  endAtMs: number
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
  boundaryBefore: TelemetryMinuteBucket['boundaryBefore']
  routePoints: RideRoutePoint[]
  weather: RideWeather | null
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/WeatherObservations.kt `RideWeather`
 * @parity /modules/vescape-core/ios/telemetry/WeatherObservations.swift `RideWeather`
 */
export interface RideWeather {
  icon: WeatherIconSlug
  minTemperatureC: number
  maxTemperatureC: number
  maxGustKmh: number | null
  rainMinutes: number
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideHistoryRepository.kt `RideWeatherCondition`
 * @parity /modules/vescape-core/ios/telemetry/RideHistoryRepository.swift `RideWeatherCondition`
 */
export type RideWeatherCondition =
  'clear' | 'cloudy' | 'rain' | 'snow' | 'storm' | 'cold' | 'hot' | 'windy' | 'night'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideHistoryRepository.kt `RideHistoryFilter`
 * @parity /modules/vescape-core/ios/telemetry/RideHistoryRepository.swift `RideHistoryFilter`
 */
export interface RideHistoryFilter {
  fromMs?: number
  toMs?: number
  boardIds?: string[]
  weather?: RideWeatherCondition[]
}

export interface RideHistoryPageOptions extends RideHistoryFilter {
  limit?: number
  cursorBeforeMs?: number
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideHistoryRepositoryAndroid.kt `getPage`
 * @parity /modules/vescape-core/ios/telemetry/RideHistoryRepository.swift `getPage`
 */
export interface RideHistoryPage {
  sessions: RideHistorySession[]
  hasMore: boolean
  nextCursorBeforeMs: number | null
}

export interface LegalPolicyReference {
  jurisdictionCode: string
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherAlerts.kt `WEATHER_ALERT_LEVEL_SETTINGS`
 * @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `weatherAlertLevelSettings`
 */
export type WeatherAlertLevelSetting = 'off' | WeatherAlertLevel

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/PersistenceDefaults.kt `validDistanceUnit`
 * @parity /modules/vescape-core/ios/telemetry/PersistenceDefaults.swift `validDistanceUnit`
 */
export type DistanceUnit = 'km' | 'mi'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/PersistenceDefaults.kt `validTemperatureUnit`
 * @parity /modules/vescape-core/ios/telemetry/PersistenceDefaults.swift `validTemperatureUnit`
 */
export type TemperatureUnit = 'celsius' | 'fahrenheit'
/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/PersistenceDefaults.kt `validTimeFormat`
 * @parity /modules/vescape-core/ios/telemetry/PersistenceDefaults.swift `validTimeFormat`
 */
export type TimeFormat = '24h' | '12h'
export type WeatherAlertLevel = 'sensitive' | 'normal' | 'extreme'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt `AppSettings`
 * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `defaultSettings`
 */
export interface AppSettings {
  liveHistoryLimit: number
  autoConnect: boolean
  autoRecording: boolean
  selectedBoardId: string | null
  lastGpsLatitude: number | null
  lastGpsLongitude: number | null
  directionPointLatitude: number | null
  directionPointLongitude: number | null
  movingSpeedThresholdKmh: number
  rideSplitGapMinutes: number
  distanceUnit: DistanceUnit
  temperatureUnit: TemperatureUnit
  timeFormat: TimeFormat
  themeMode: 'system' | 'light' | 'dark' | 'sun'
  mapStyleKey: 'onedark' | 'outdoors' | 'satellite' | 'mapy'
  satelliteOverlayEnabled: boolean
  satelliteImageryOpacity: number
  satelliteMapImageryOpacity: number
  satelliteImagerySaturation: number
  hideTelemetryMapDetails: boolean
  showHistoryMapMarkers: boolean
  navigationRerouteDistanceMeters: number
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
  socEstimateWindowSeconds: number
  boardMoveStrengthPercent: number
  connectionSoundsEnabled: boolean
  /** @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/EffectsPacks.kt */
  /** @parity /modules/vescape-core/ios/alerts/EffectsPacks.swift */
  soundPack: string
  /** @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt `AppSettings` */
  /** @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `defaultSettings` */
  audioSource: 'alarm' | 'media'
  /** @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt `AppSettings` */
  /** @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `defaultSettings` */
  voice: 'matching' | 'nova' | 'radio' | 'nicole'
  /** @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt `VOICE_LEVELS` */
  /** @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `voiceLevels` */
  voiceLevel: 'off' | 'minimal' | 'standard' | 'full'
  weatherRainAlertLevel: WeatherAlertLevelSetting
  weatherWindAlertLevel: WeatherAlertLevelSetting
  companionPresenceEnabled: boolean
  boardWarningsEnabled: boolean
  vescFaultCollectionEnabled: boolean
  companionPresenceCooldownMinutes: number
  autoCloseEnabled: boolean
  autoCloseDelayMinutes: number
  telemetryPollRateHz: number
  /**
   * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `wearPushRateHz`
   * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `validWearPushRateHz`
   */
  wearPushRateHz: number
  /**
   * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMirrorLauncher.kt
   */
  wearAutoLaunchOnConnect: boolean
  /**
   * @parity /modules/vescape-core/ios/watch/WatchSettings.swift `WatchSettings`
   * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchSettings.kt
   */
  wearNavArrowEnabled: boolean
  /**
   * @parity /modules/vescape-core/ios/watch/WatchSettings.swift
   * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchSettings.kt
   */
  wearTelemetryTrailEnabled: boolean
  /**
   * @parity /modules/vescape-core/ios/watch/WatchSettings.swift
   * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchSettings.kt
   */
  wearTelemetryGroupEnabled: boolean
  /**
   * @parity /modules/vescape-core/ios/watch/WatchSettings.swift
   * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchSettings.kt
   */
  wearTelemetryRouteEnabled: boolean
  /**
   * @parity /modules/vescape-core/ios/watch/WatchSettings.swift
   * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchSettings.kt
   */
  wearStreetMapEnabled: boolean
  /**
   * @parity /modules/vescape-core/ios/watch/WatchMapTile.swift `WatchMapGauges`
   * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTile.kt `WatchMapGauges`
   */
  wearMapGaugesPercent: number
  /**
   * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchSettings.kt
   * @parity /modules/vescape-core/ios/watch/WatchSettings.swift
   */
  wearTiltRatePercent: number
  legalPolicy: LegalPolicyReference | null
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
  boardId: string | null
  message: string | null
  propertiesJson: string
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/MaintenanceRunner.kt `MaintenanceJobState`
 * @parity /modules/vescape-core/ios/telemetry/MaintenanceRunner.swift `MaintenanceJobState`
 */
export interface MaintenanceJobState {
  id: string
  status: 'pending' | 'running' | 'done' | 'waitingForNetwork' | 'failed'
  done: number
  total: number
  lastRunAtMs: number | null
  lastDurationMs: number | null
  lastError: string | null
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/MaintenanceRunner.kt `buildSnapshot`
 * @parity /modules/vescape-core/ios/telemetry/MaintenanceRunner.swift `buildSnapshot`
 */
export interface MaintenanceState {
  running: boolean
  historyRevision: number
  jobs: MaintenanceJobState[]
}

export interface DatabaseBackupResult {
  uri: string
  name: string
  sizeBytes: number
}

export interface DebugRecording {
  name: string
  createdAt: number
  sizeBytes: number
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/replay/ReplayRecordings.kt `listBundled`
 * @parity /modules/vescape-core/ios/replay/ReplayRecordings.swift `listBundled`
 */
export interface DebugFixture {
  name: string
  sizeBytes: number
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `startDebugReplay`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `startDebugReplay`
 */
export interface DebugReplayOptions {
  warmupMs?: number
  loop?: boolean
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/replay/SimulatedBoard.kt `ReplayPlaybackState`
 * @parity /modules/vescape-core/ios/replay/SimulatedBoard.swift `ReplayPlaybackState`
 */
export interface DebugReplayState {
  recording: string
  positionMs: number
  durationMs: number
  paused: boolean
  loop: boolean
  linked: boolean
}

export interface LiveSeriesEvent {
  metrics: Record<string, number[]>
  generation: number
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/LiveSeriesEmitter.kt `emitFocusedSeries`
 * @parity /modules/vescape-core/ios/telemetry/LiveSeriesEmitter.swift `emitFocusedSeries`
 */
export interface FocusedSeriesEvent {
  metric: string
  series: number[]
  exclusions: Record<string, number[]>
  windowMs: number
  spanMs: number
  sampleRateHz: number
  generation: number
}

export interface RiderPresence {
  lat: number
  lng: number
  heading?: number | null
  speed?: number | null
  soc?: number | null
  motorTemp?: number | null
  ctrlTemp?: number | null
  phoneBattery?: number | null
  boardName?: string | null
  target?: { lat: number; lng: number } | null
}

export interface TrailPoint {
  lat: number
  lng: number
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignal.kt `RiderSignalKind`
 * @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `RiderSignalKind`
 */
export const RIDER_SIGNAL_KINDS = [
  'down',
  'minor',
  'serious',
  'battery',
  'tire',
  'overheat',
  'board',
  'wait',
  'break',
] as const

export type RiderSignalKind = (typeof RIDER_SIGNAL_KINDS)[number]

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignal.kt `RideHazardKind`
 * @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `RideHazardKind`
 */
export const RIDE_HAZARD_KINDS = ['water', 'terrain', 'obstacle', 'police'] as const

export type RideHazardKind = (typeof RIDE_HAZARD_KINDS)[number]

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignal.kt `RiderPin`
 * @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `RiderPin`
 */
export interface GroupRidePin {
  kind: string
  lat: number
  lng: number
  startedAt: number
  expiresAt: number
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/GroupRideObserver.kt `riderView`
 * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `riderView`
 */
export interface GroupRideRider {
  id: string
  name: string
  presence: RiderPresence | null
  trail?: TrailPoint[] | null
  stale: boolean
  away: boolean
  lastSeen: number
  signal?: GroupRidePin | null
  hazard?: GroupRidePin | null
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/GroupRideObserver.kt `emitConnection`
 * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `emitConnection`
 */
export type GroupRideConnectionState =
  'idle' | 'connecting' | 'connected' | 'disconnected' | 'blocked'

export interface GroupRideConnectionEvent {
  state: GroupRideConnectionState
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/GroupRideObserver.kt `refreshSignalAvailability`
 * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `refreshSignalAvailability`
 */
export interface GroupRideSignalAvailability {
  supported: boolean
  hazardsSupported: boolean
  insidePrivacyZone: boolean
  hasRecentFix: boolean
}

export interface GroupRideErrorEvent {
  message: string
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/PublicRide.kt `emitStatus`
 * @parity /modules/vescape-core/ios/groupride/PublicRide.swift `emitStatus`
 */
export interface PublicRideStatus {
  activation: 'off' | 'waiting' | 'phone' | 'board'
  until: number | null
  live: boolean
  supported: boolean
  reason: 'replaced' | 'end-time' | 'away-expired' | 'signed-out' | 'refused' | null
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/PublicRide.kt `publicRiderView`
 * @parity /modules/vescape-core/ios/groupride/PublicRide.swift `publicRiderView`
 */
export interface PublicRider {
  accountId: string
  nick: string
  presence: RiderPresence | null
  trail?: TrailPoint[] | null
  stale: boolean
  away: boolean
  lastSeen: number
}

export interface PublicRidersEvent {
  riders: PublicRider[]
  now: number | null
}

export interface PublicRiderPins {
  accountId: string
  nick: string
  signal: GroupRidePin | null
  hazard: GroupRidePin | null
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/PublicRide.kt `emitPins`
 * @parity /modules/vescape-core/ios/groupride/PublicRide.swift `emitPins`
 */
export interface PublicPinsEvent {
  pins: PublicRiderPins[]
  own: { signal: GroupRidePin | null; hazard: GroupRidePin | null }
  now: number
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `AppDataScope`
 * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `AppDataScope`
 */
export interface AppDataChangedEvent {
  scope: 'boards' | 'settings' | 'alerts'
}

/**
 * @parity /modules/vescape-core/ios/warnings/BoardWarningKind.swift `BoardWarningSeverity`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/warnings/BoardWarningRegistry.kt `BoardWarningSeverity`
 */
export type BoardWarningSeverity = 'warn' | 'critical'

/**
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

/**
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
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `sendBoardWarnings`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `onBoardWarnings`
 */
export interface BoardWarningsEvent {
  boardId: string
  warnings: BoardWarning[]
}

/**
 * @parity /modules/vescape-core/ios/faults/VescFaultCoordinator.swift `VescFaultOccurrence`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultCoordinator.kt `VescFaultOccurrence`
 */
export interface VescFaultOccurrence {
  id: string
  boardId: string
  code: number
  occurredAtMs: number
  lastObservedAtMs: number
  clearedAtMs: number | null
  dismissed: boolean
}

/**
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `sendVescFaults`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `onVescFaults`
 */
export interface VescFaultsEvent {
  boardId: string
  faults: VescFaultOccurrence[]
}

/**
 * @parity /modules/vescape-core/ios/faults/VescFaultCaptureCoordinator.swift `VescFaultCaptureSample`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultCaptureCoordinator.kt `VescFaultCaptureSample`
 */
export interface VescFaultCaptureSample {
  capturedAtMs: number
  speed: number | null
  dutyCycle: number | null
  erpm: number | null
  batteryVoltage: number | null
  batteryCurrent: number | null
  motorCurrent: number | null
  tempMosfet: number | null
  tempMotor: number | null
  pitch: number | null
  roll: number | null
  balancePitch: number | null
  adc1: number | null
  adc2: number | null
  state: number | null
}

/**
 * @parity /modules/vescape-core/ios/faults/VescFaultCaptureCoordinator.swift `VescFaultCapture`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultCaptureCoordinator.kt `VescFaultCapture`
 */
export interface VescFaultCapture {
  occurrenceId: string
  boardId: string
  startedAtMs: number
  openedAtMs: number
  sampleCount: number
}

/**
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getVescFaultCapture`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getVescFaultCapture`
 */
export interface VescFaultCaptureDetail extends VescFaultCapture {
  samples: VescFaultCaptureSample[]
}

/**
 * @parity /modules/vescape-core/ios/config/BoardConfigValues.swift `BoardConfigFreshness`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigValues.kt `BoardConfigFreshness`
 */
export type BoardConfigFreshness = 'fresh' | 'last-known'

/**
 * @parity /modules/vescape-core/ios/config/BoardConfigValues.swift `BoardConfigValues`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigValues.kt `BoardConfigValues`
 */
/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigFields.kt
 * @parity /modules/vescape-core/ios/config/BoardConfigFields.swift
 */
export type BoardConfigFieldId =
  | 'atr_amps_accel_ratio'
  | 'atr_amps_decel_ratio'
  | 'atr_angle_limit'
  | 'atr_filter'
  | 'atr_off_speed'
  | 'atr_on_speed'
  | 'atr_response_boost'
  | 'atr_speed_boost'
  | 'atr_strength_down'
  | 'atr_strength_up'
  | 'atr_threshold_down'
  | 'atr_threshold_up'
  | 'atr_transition_boost'
  | 'booster_current'
  | 'brake_current'
  | 'braketilt_lingering'
  | 'braketilt_strength'
  | 'brkbooster_current'
  | 'enable_quickstop'
  | 'fault_adc1'
  | 'fault_adc2'
  | 'fault_adc_half_erpm'
  | 'fault_darkride_enabled'
  | 'fault_delay_pitch'
  | 'fault_delay_roll'
  | 'fault_delay_switch_full'
  | 'fault_delay_switch_half'
  | 'fault_is_dual_switch'
  | 'fault_moving_fault_disabled'
  | 'fault_pitch'
  | 'fault_reversestop_enabled'
  | 'fault_roll'
  | 'is_dutybeep_enabled'
  | 'ki'
  | 'ki_limit'
  | 'kp'
  | 'kp2'
  | 'kp2_brake'
  | 'kp_brake'
  | 'mahony_kp'
  | 'mahony_kp_roll'
  | 'startup_click_current'
  | 'startup_dirtylandings_enabled'
  | 'startup_pitch_tolerance'
  | 'startup_pushstart_enabled'
  | 'startup_roll_tolerance'
  | 'startup_simplestart_enabled'
  | 'startup_speed'
  | 'tiltback_constant'
  | 'tiltback_constant_erpm'
  | 'tiltback_duty'
  | 'tiltback_duty_angle'
  | 'tiltback_duty_speed'
  | 'tiltback_hv'
  | 'tiltback_hv_angle'
  | 'tiltback_hv_speed'
  | 'tiltback_lv'
  | 'tiltback_lv_angle'
  | 'tiltback_lv_speed'
  | 'tiltback_return_speed'
  | 'tiltback_variable'
  | 'tiltback_variable_erpm'
  | 'tiltback_variable_max'
  | 'torquetilt_angle_limit'
  | 'torquetilt_off_speed'
  | 'torquetilt_on_speed'
  | 'torquetilt_start_current'
  | 'torquetilt_strength'
  | 'torquetilt_strength_regen'
  | 'turntilt_angle_limit'
  | 'turntilt_erpm_boost'
  | 'turntilt_erpm_boost_end'
  | 'turntilt_speed'
  | 'turntilt_start_angle'
  | 'turntilt_start_erpm'
  | 'turntilt_strength'
  | 'turntilt_yaw_aggregate'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigValues.kt `BoardConfigValues`
 * @parity /modules/vescape-core/ios/config/BoardConfigValues.swift `BoardConfigValues`
 */
export type BoardConfigFieldValues = {
  [K in BoardConfigFieldId]?: number | boolean
} & Record<string, number | boolean | undefined>

export interface BoardConfigValues {
  boardId: string | null
  refloatBaseVersion: string | null
  capturedAtMs: number
  freshness: BoardConfigFreshness
  values: BoardConfigFieldValues
}

/**
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getBoardConfigValues`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getBoardConfigValues`
 */
export interface BoardConfigValuesEvent {
  values: BoardConfigValues | null
}

/**
 * @parity /modules/vescape-core/ios/config/MotorConfigValues.swift `MotorConfigValues`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/MotorConfigValues.kt `MotorConfigValues`
 */
export interface MotorConfigValues {
  boardId: string | null
  signature: number
  firmware: string
  capturedAtMs: number
  freshness: BoardConfigFreshness
  values: Record<string, number>
}

/**
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getMotorConfigValues`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getMotorConfigValues`
 */
export interface MotorConfigValuesEvent {
  values: MotorConfigValues | null
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigChangeNotice.kt `BoardConfigChangeDiff`
 * @parity /modules/vescape-core/ios/config/BoardConfigStore.swift `BoardConfigChangeDiff`
 */
export interface BoardConfigChangeDiff {
  fieldId: string
  label: string
  unit: string | null
  oldValue: number | boolean | null
  newValue: number | boolean | null
}
export interface BoardConfigChangeNotice {
  boardId: string
  detectedAtMs: number
  diffs: BoardConfigChangeDiff[]
}
export interface BoardConfigChangeNoticeEvent {
  notice: BoardConfigChangeNotice | null
}

/**
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
 * @parity /modules/vescape-core/ios/appstatus/AppStatus.swift `CommunityMessage`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatus.kt `CommunityMessage`
 */
export interface CommunityMessage {
  id: string
  type: CommunityMessageType
  title: string | null
  body: string
  action: CommunityMessageAction | null
}

/**
 * @parity /modules/vescape-core/ios/appstatus/AppStatus.swift `AppStatusVersion`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatus.kt `AppStatusVersion`
 */
export interface AppStatusVersion {
  installed: string
  latest: string
  status: AppVersionStatus
  message: string | null
}

/**
 * @parity /modules/vescape-core/ios/appstatus/AppStatus.swift `AppStatus`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatus.kt `AppStatus`
 */
export interface AppStatus {
  version: AppStatusVersion
  messages: CommunityMessage[]
}

/**
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `sendAppStatus`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `onAppStatus`
 */
export interface AppStatusEvent {
  status: AppStatus | null
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/serviceconfig/ServiceConfig.kt `ServiceConfig`
 * @parity /modules/vescape-core/ios/serviceconfig/ServiceConfig.swift `ServiceConfig`
 */
export interface ServiceConfig {
  mapboxToken: string | null
  mapyToken: string | null
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `onServiceConfig`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `sendServiceConfig`
 */
export interface ServiceConfigEvent {
  config: ServiceConfig
}

/**
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
  sunriseMinuteOfDay: number | null
  sunsetMinuteOfDay: number | null
  latitude: number
  longitude: number
  fetchedAtMs: number
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `onWeather`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `sendWeather`
 */
export interface WeatherEvent {
  weather: Weather | null
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/RerouteDistance.kt
 * @parity /modules/vescape-core/ios/navigation/NavigationController.swift `defaultRerouteDistanceMeters`
 */
export const NAVIGATION_REROUTE_DISTANCE = { defaultMeters: 50, minMeters: 1, maxMeters: 1000 }

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationController.kt `Navigation`
 * @parity /modules/vescape-core/ios/navigation/NavigationController.swift `Navigation`
 */
export interface Navigation {
  target: { latitude: number; longitude: number }
  profile: NavigationProfile
  computedAtMs: number
  revision: number
  automatic: boolean
  status: NavigationStatus
  distanceMeters: number
  durationSeconds: number
  coordinates: [longitude: number, latitude: number][]
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationController.kt `NavigationStatus`
 * @parity /modules/vescape-core/ios/navigation/NavigationController.swift `NavigationStatus`
 */
export type NavigationStatus = 'ready' | 'fetchFailed' | 'noPathFound'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationController.kt `NavigationProfile`
 * @parity /modules/vescape-core/ios/navigation/NavigationController.swift `NavigationProfile`
 */
export type NavigationProfile = 'walking' | 'cycling' | 'driving'

/**
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `sendNavigation`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `onNavigation`
 */
export interface NavigationEvent {
  navigation: Navigation | null
  computing: boolean
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/RouteProgress.kt `RouteProgress`
 * @parity /modules/vescape-core/ios/navigation/RouteProgress.swift `RouteProgress`
 */
export interface RouteProgress {
  navigationRevision: number
  segmentIndex: number
  segmentFraction: number
  deviationMeters: number
  latitude: number
  longitude: number
  remainingMeters: number
  remainingDurationSeconds: number | null
  bearingDeg: number
}

/**
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
  'not-determined' | 'denied' | 'authorized' | 'provisional' | 'ephemeral' | 'unknown'

/**
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `Events`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `Events`
 */
type VescapeCoreEvents = {
  onDevice: (event: DeviceFoundEvent) => void
  onError: (event: ErrorEvent) => void
  onLiveState: (event: LiveStateEvent) => void
  onLiveTick: (event: TelemetryEvent) => void
  onLiveSeries: (event: LiveSeriesEvent) => void
  onFocusedSeries: (event: FocusedSeriesEvent) => void
  onBms: (event: BmsEvent) => void
  onBmsSeries: (event: NativeBmsSeriesEvent) => void
  onLocation: (event: LocationEvent) => void
  onMaintenanceState: (event: MaintenanceState) => void
  onBoardProbeProgress: (event: BoardProbeProgressEvent) => void
  onRideExportProgress: (event: RideExportProgressEvent) => void
  onGroupRideConnection: (event: GroupRideConnectionEvent) => void
  onGroupRideError: (event: GroupRideErrorEvent) => void
  onGroupRideSignalAvailability: (event: GroupRideSignalAvailability) => void
  onPublicRideStatus: (event: PublicRideStatus) => void
  onPublicRiders: (event: PublicRidersEvent) => void
  onPublicPins: (event: PublicPinsEvent) => void
  onAppDataChanged: (event: AppDataChangedEvent) => void
  onBoardWarnings: (event: BoardWarningsEvent) => void
  onVescFaults: (event: VescFaultsEvent) => void
  onBoardConfigValues: (event: BoardConfigValuesEvent) => void
  onMotorConfigValues: (event: MotorConfigValuesEvent) => void
  onBoardConfigChangeNotice: (event: BoardConfigChangeNoticeEvent) => void
  onBoardLights: (event: BoardLightsEvent) => void
  onAppStatus: (event: AppStatusEvent) => void
  onServiceConfig: (event: ServiceConfigEvent) => void
  onNavigation: (event: NavigationEvent) => void
  onRouteProgress: (event: RouteProgressEvent) => void
  onWeather: (event: WeatherEvent) => void
  onRideNotices: (event: RideNoticesEvent) => void
  onAccessoryDevice: (event: AccessoryDeviceEvent) => void
  onAccessoryScanError: (event: AccessoryScanErrorEvent) => void
  onAccessoryState: (event: AccessoryStateEvent) => void
  onAccessoryReading: (event: AccessoryReadingEvent) => void
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
  startAccessoryScan(): void
  stopAccessoryScan(): void
  cancelAccessoryInspection(): void
  inspectAccessory(deviceId: string): Promise<AccessoryInspection>
  enrollAccessory(deviceId: string): Promise<AccessoryEnrollment>
  forgetAccessory(accessoryId: string): Promise<boolean>
  getAccessories(): SavedAccessory[]
  setAccessoryCapabilityEnabled(
    accessoryId: string,
    capabilityId: string,
    enabled: boolean,
  ): Promise<boolean>
  setAccessorySamplingRate(
    accessoryId: string,
    capabilityId: string,
    rateHz: number,
  ): Promise<boolean>
  saveBrakeLightSettings(
    accessoryId: string,
    capabilityId: string,
    sensitivity: number,
    parked: string,
  ): Promise<boolean>
  setBrakeLightPreview(
    accessoryId: string,
    capabilityId: string,
    mode: BrakeLightMode | null,
  ): Promise<boolean>
  setAccessoryPreview(accessoryId: string, capabilityId: string, open: boolean): void
  saveGroundClearanceCalibration(
    accessoryId: string,
    capabilityId: string,
    nearCm: number,
    farCm: number,
    direction: string,
    strengthPercent: number,
  ): Promise<GroundClearanceSaveResult>
  clearGroundClearanceCalibration(accessoryId: string, capabilityId: string): Promise<boolean>
  exitApp(): void
  refreshLocationDemand(): void
  startGroupRideObserve(serverUrl: string): void
  stopGroupRideObserve(): void
  sendGroupRideSignal(kind: RiderSignalKind): void
  clearGroupRideSignal(): void
  sendGroupRideHazard(kind: RideHazardKind): void
  clearGroupRideHazard(): void
  setPublicRide(on: boolean, until: number | null): void
  setManualPublicRideSharing(enabled: boolean): void
  watchPublicRiders(): void
  stopWatchingPublicRiders(): void
  setTelemetryRecordingEnabled(enabled: boolean): void
  setBmsSeriesFocused(focused: boolean): void
  setFocusedSeriesMetrics(metrics: string[]): void
  setLiveSeriesMetrics(metrics: string[]): void
  reloadAlertRules(): void
  getCriticalRideNotificationPermissionStatus(): Promise<CriticalRideNotificationPermissionStatus>
  requestCriticalRideNotificationPermission(): Promise<CriticalRideNotificationPermissionStatus>
  getAlertSounds(): AlertSound[]
  previewAlertSound(spec: AlertSpec): void
  previewWeatherAlert(
    kind: WeatherAlertPreviewKind,
    leadMinutes: number,
    percent: number | null,
  ): void
  playPackSound(pack: string, slot: PackSoundSlot): void
  mapTile(z: number, x: number, y: number): Promise<string | null>
  mySounds(): Promise<MySoundsState>
  importMySound(uri: string, name: string): Promise<MySoundsState>
  renameMySound(id: string, name: string): Promise<MySoundsState>
  deleteMySound(id: string): Promise<MySoundsState>
  setSoundOverride(slot: SoundOverrideSlot, id: string | null): Promise<MySoundsState>

  startGeigerSimulation(spec: string, rangeDepth: number): void
  stopGeigerSimulation(): void
  startAlertTest(rules: AlertTestRule[]): void
  updateAlertTest(value: number): void
  stopAlertTest(): void
  selectBoard(boardId: string): Promise<void>
  stopBoard(): Promise<void>
  probeBoardLink(bleId: string, probeId: string): Promise<BoardProbeResult>
  finalizeBoardLink(
    probeId: string,
    boardId: string,
    bleId: string,
    candidate: BoardCandidate,
  ): Promise<BoardLink>
  cancelBoardProbe(probeId: string): void
  setDebugRecordingEnabled(enabled: boolean): void
  listDebugRecordings(): Promise<DebugRecording[]>
  listBundledDebugFixtures(): Promise<DebugFixture[]>
  exportDebugRecording(name: string): Promise<DatabaseBackupResult>
  deleteDebugRecording(name: string): Promise<void>
  startDebugReplay(name: string, options: DebugReplayOptions | null): Promise<void>
  setWatchRouteSpanM(spanM: number | null): void
  stopDebugReplay(): Promise<void>
  getDebugReplayState(): DebugReplayState | null
  setDebugReplayPaused(paused: boolean): DebugReplayState | null
  setDebugReplayLoop(loop: boolean): DebugReplayState | null
  dropDebugReplayLink(): DebugReplayState | null
  reportUiError(message: string, source?: string | null, stack?: string | null): void
  reportDiagnosticTest(): DiagnosticStatus
  getDiagnosticStatus(): DiagnosticStatus
  getPhoneBatteryLevel(): Promise<number | null>
  getLiveState(): LiveStateEvent
  getAppStatus(): AppStatus | null
  getServiceConfig(): ServiceConfig
  getWeather(): Weather | null
  refreshWeather(): void
  getWeatherAlertThresholds(): WeatherAlertThresholds
  provisionDeviceCredential(
    serverUrl: string,
    deviceToken: string,
    accountId: string,
  ): Promise<DeviceCredentialStatus>
  getDeviceCredentialState(): DeviceCredentialStatus
  revokeDeviceCredential(): Promise<void>
  clearDeviceCredential(): void
  openAppUpdate(): void
  getRemoteTiltState(): Promise<RemoteTiltState | null>
  getGroundClearanceTilt(): Promise<GroundClearanceTiltState>
  setSelectedBoard(boardId: string | null): void
  setCompanionPresenceEnabled(enabled: boolean): Promise<void>
  getCompanionPresenceBoards(): Promise<CompanionPresenceBoard[]>
  addCompanionPresenceBoard(boardId: string): Promise<void>
  removeCompanionPresenceBoard(boardId: string): Promise<void>
  getTelemetryHistory(options: TelemetryHistoryOptions): Promise<TelemetryMinuteBucket[]>
  getRideHistoryPage(options: RideHistoryPageOptions): Promise<RideHistoryPage>
  countRideHistory(filter: RideHistoryFilter): Promise<number>
  getRideSession(id: string): Promise<RideHistorySession | null>
  getTelemetrySamples(options: {
    fromMs: number
    toMs: number
    boardId?: string
    limit?: number
  }): Promise<TelemetrySample[]>
  exportRideGpx(options: RideExportOptions): Promise<RideExportFile>
  exportRideCsv(options: RideExportOptions): Promise<RideExportFile>
  exportRideFloaty(options: RideExportOptions): Promise<RideExportFile>
  exportLiveTelemetryCsv(): Promise<RideExportFile>
  exportRides(options: {
    selection: RideSelection
    format: RideExportFormat
  }): Promise<RideExportFile | null>
  cancelRideExport(): void
  deleteRides(selection: RideSelection): Promise<number>
  getHistoryRange(options: {
    fromMs: number
    toMs: number
    boardId?: string
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
  getRideNotices(): RideNotice[]
  dismissRideNotice(id: number, rev: number): void
  devPostRideNotice(notice: DevRideNoticeParams): void
  devClearRideNotice(key: string): void
  clearBoardWarning(boardId: string, kind: string): Promise<void>
  clearAllBoardWarnings(boardId: string): Promise<void>
  devInjectBoardWarning(
    boardId: string,
    kind: string,
    severity: BoardWarningSeverity,
    payloadJson: string,
  ): Promise<void>
  devReportCleanBoardWarning(boardId: string, kind: string): Promise<void>
  getVescFaults(): Promise<VescFaultOccurrence[]>
  setVescFaultDismissed(id: string, dismissed: boolean): Promise<void>
  getVescFaultCapture(occurrenceId: string): Promise<VescFaultCaptureDetail | null>
  readVescFaultLog(boardId: string): Promise<string>
  getBoardConfigValues(): Promise<BoardConfigValues | null>
  getLastKnownBoardConfigValues(boardId: string): Promise<BoardConfigValues | null>
  getMotorConfigValues(): Promise<MotorConfigValues | null>
  getLastKnownMotorConfigValues(boardId: string): Promise<MotorConfigValues | null>
  getBoardConfigChangeNotice(boardId: string): Promise<BoardConfigChangeNotice | null>
  dismissBoardConfigChangeNotice(boardId: string): Promise<void>
  setBoardConfigChangeFieldIgnored(
    boardId: string,
    fieldId: string,
    ignored: boolean,
  ): Promise<void>
  clearIgnoredBoardConfigChangeFields(boardId: string): Promise<void>
  getDatabaseSizeBytes(): Promise<number>
  backupDatabase(): Promise<DatabaseBackupResult>
  restoreDatabase(uri: string): Promise<void>
  getRefloatConfigSnapshot(): Promise<RefloatConfigSnapshot>
  setRemoteTilt(value: number): Promise<boolean>
  lockRemoteTilt(value: number): Promise<boolean>
  releaseRemoteTilt(value: number, durationMs: number): Promise<boolean>
  stopRemoteTilt(): Promise<boolean>
  setBoardLights(enabled: boolean, headlightsEnabled: boolean): Promise<boolean>
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
  pushProfileToBoard(profileId: string, fieldIds: string[]): Promise<RefloatConfigSnapshot>
  getProfileStatsSnapshot(options: ProfileStatsSnapshotOptions): Promise<ProfileStatsSnapshot>
  getDayStats(day: RideDay): Promise<ProfileStats>
  getRecentRideStats(sinceMs: number): Promise<ProfileStats>
  getMaintenanceState(): MaintenanceState
  deleteTelemetryBefore(beforeMs: number): Promise<number>
  deleteTelemetryRange(options: TelemetryDeleteRangeOptions): Promise<number>
  clearTelemetryHistory(): Promise<void>
  getBoards(): Promise<Board[]>
  upsertBoard(board: BoardInput, initialAlerts: InitialBoardAlerts | null): Promise<void>
  deleteBoard(id: string): Promise<void>
  getAlertRules(boardId: string): Promise<AlertRule[]>
  getAlertPresets(boardId: string): Promise<Record<AlertPresetMetric, string>>
  previewAlertPreset(
    metric: AlertPresetMetric,
    spec: string,
    topSpeedKmh: number,
    hasBatteryConfig: boolean,
    distanceUnit: DistanceUnit,
  ): AlertTestRule[]
  applyAlertPreset(
    boardId: string,
    metric: string,
    level: string | null,
    geiger: string | null,
    match: boolean | null,
  ): Promise<void>
  upsertAlertRule(rule: AlertRule): Promise<void>
  setAlertRuleEnabled(boardId: string, id: string, enabled: boolean): Promise<void>
  deleteAlertRule(boardId: string, id: string): Promise<void>
  getPrivacyZones(): Promise<PrivacyZone[]>
  upsertPrivacyZone(zone: PrivacyZone): Promise<void>
  setPrivacyZoneEnabled(id: string, enabled: boolean): Promise<void>
  deletePrivacyZone(id: string): Promise<void>
  searchMap(query: string, limit: number, proximity: string | null): Promise<string>
  reverseGeocodeMap(latitude: number, longitude: number): Promise<string>
  getNearbyMapPoints(
    latitude: number,
    longitude: number,
    radiusMeters: number,
  ): Promise<NearbyMapPoints>
  createMapPoint(values: MapPointValues): Promise<MapPoint>
  updateMapPoint(id: string, patch: MapPointPatch): Promise<MapPoint>
  deleteMapPoint(id: string): Promise<void>
  setMapPointReaction(id: string, reaction: MapPointReaction | null): Promise<void>
  getRiderProfile(): Promise<RiderProfile | null>
  saveRiderProfile(nick: string, nationality: string | null): Promise<RiderProfile>
  searchRiders(nick: string): Promise<RiderProfile[]>
  getRider(accountId: string): Promise<RiderDetail | null>
  getFriends(): Promise<Friends>
  sendFriendRequest(accountId: string): Promise<FriendRequestStatus>
  acceptFriendRequest(accountId: string): Promise<void>
  deleteFriendRequest(accountId: string): Promise<void>
  removeFriend(accountId: string): Promise<void>
  getRodeWith(from: string, to: string): Promise<RodeWithCrewRide[]>
  getFriendRides(
    accountId: string,
    limit: number | null,
    before: string | null,
  ): Promise<FriendRidesPage>
  getFriendRideTrack(accountId: string, from: string, to: string): Promise<PublicTrackPoint[]>
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

const FAKE_SCAN = E2E_ENABLED || process.env.EXPO_PUBLIC_SMOKE === '1'

export function scan(): void {
  if (FAKE_SCAN) {
    e2eFake.scan()
    return
  }

  native.scan()
}

export function stopScan(): void {
  if (FAKE_SCAN) {
    e2eFake.stopScan()
    return
  }

  native.stopScan()
}

export function startAccessoryScan(): void {
  native.startAccessoryScan()
}

export function stopAccessoryScan(): void {
  native.stopAccessoryScan()
}

export function inspectAccessory(deviceId: string): Promise<AccessoryInspection> {
  return native.inspectAccessory(deviceId)
}

export function cancelAccessoryInspection(): void {
  native.cancelAccessoryInspection()
}

export function enrollAccessory(deviceId: string): Promise<AccessoryEnrollment> {
  return native.enrollAccessory(deviceId)
}

export function forgetAccessory(accessoryId: string): Promise<boolean> {
  return native.forgetAccessory(accessoryId)
}

export function setAccessoryPreview(
  accessoryId: string,
  capabilityId: string,
  open: boolean,
): void {
  native.setAccessoryPreview(accessoryId, capabilityId, open)
}

export function saveGroundClearanceCalibration(
  accessoryId: string,
  capabilityId: string,
  calibration: {
    nearCm: number
    farCm: number
    direction: GroundClearanceDirection
    strengthPercent: number
  },
): Promise<GroundClearanceSaveResult> {
  return native.saveGroundClearanceCalibration(
    accessoryId,
    capabilityId,
    calibration.nearCm,
    calibration.farCm,
    calibration.direction,
    calibration.strengthPercent,
  )
}

export function clearGroundClearanceCalibration(
  accessoryId: string,
  capabilityId: string,
): Promise<boolean> {
  return native.clearGroundClearanceCalibration(accessoryId, capabilityId)
}

export function getAccessories(): SavedAccessory[] {
  return native.getAccessories()
}

export function refreshLocationDemand(): void {
  native.refreshLocationDemand()
}

export function startGroupRideObserve(serverUrl: string): void {
  if (E2E_ENABLED) return
  native.startGroupRideObserve(serverUrl)
}

export function stopGroupRideObserve(): void {
  if (E2E_ENABLED) return
  native.stopGroupRideObserve()
}

export function sendGroupRideSignal(kind: RiderSignalKind): void {
  if (E2E_ENABLED) return
  native.sendGroupRideSignal(kind)
}

export function clearGroupRideSignal(): void {
  if (E2E_ENABLED) return
  native.clearGroupRideSignal()
}

export function sendGroupRideHazard(kind: RideHazardKind): void {
  if (E2E_ENABLED) return
  native.sendGroupRideHazard(kind)
}

export function clearGroupRideHazard(): void {
  if (E2E_ENABLED) return
  native.clearGroupRideHazard()
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setPublicRide`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `setPublicRide`
 */
export function setPublicRide(on: boolean, until: number | null): void {
  if (E2E_ENABLED) return
  native.setPublicRide(on, until)
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setManualPublicRideSharing`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `setManualPublicRideSharing`
 */
export function setManualPublicRideSharing(enabled: boolean): void {
  if (E2E_ENABLED) return
  native.setManualPublicRideSharing(enabled)
}

export function watchPublicRiders(): void {
  if (E2E_ENABLED) return
  native.watchPublicRiders()
}

export function stopWatchingPublicRiders(): void {
  if (E2E_ENABLED) return
  native.stopWatchingPublicRiders()
}

export function setTelemetryRecordingEnabled(enabled: boolean): void {
  native.setTelemetryRecordingEnabled(enabled)
}

export function setBmsSeriesFocused(focused: boolean): void {
  native.setBmsSeriesFocused(focused)
}

export function setFocusedSeriesMetrics(metrics: string[]): void {
  native.setFocusedSeriesMetrics(metrics)
}

export function setLiveSeriesMetrics(metrics: string[]): void {
  native.setLiveSeriesMetrics(metrics)
}

export function reloadAlertRules(): void {
  native.reloadAlertRules()
}

export async function getCriticalRideNotificationPermissionStatus(): Promise<CriticalRideNotificationPermissionStatus> {
  try {
    return await native.getCriticalRideNotificationPermissionStatus()
  } catch {
    return 'unknown'
  }
}

export async function requestCriticalRideNotificationPermission(): Promise<CriticalRideNotificationPermissionStatus> {
  try {
    return await native.requestCriticalRideNotificationPermission()
  } catch {
    return 'unknown'
  }
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `alertSoundMaps`
 * @parity /modules/vescape-core/ios/alerts/AlertAudioPlayer.swift `alertSoundChoices`
 */
const FALLBACK_SOUNDS: AlertSound[] = [
  { name: 'Info', uri: 'alert:info', category: 'single' },
  { name: 'Warning', uri: 'alert:warning', category: 'single' },
  { name: 'Critical', uri: 'alert:critical', category: 'single' },
  { name: 'Soft', uri: 'geiger:soft', category: 'geiger' },
  { name: 'Mid', uri: 'geiger:mid', category: 'geiger' },
  { name: 'Hard', uri: 'geiger:hard', category: 'geiger' },
]

export function getAlertSounds(): AlertSound[] {
  try {
    return native.getAlertSounds()
  } catch {
    return FALLBACK_SOUNDS
  }
}

export function previewAlertSound(spec: AlertSpec): void {
  native.previewAlertSound(spec)
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/weather/WeatherAlerts.kt `WeatherAlertKind`
 * @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `WeatherAlertKind`
 */
export type WeatherAlertPreviewKind = 'storm' | 'wind' | 'rain'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `previewWeatherAlert`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `previewWeatherAlert`
 */
export function previewWeatherAlert(
  kind: WeatherAlertPreviewKind,
  leadMinutes: number,
  percent: number | null,
): void {
  native.previewWeatherAlert(kind, leadMinutes, percent)
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/EffectsPacks.kt
 * @parity /modules/vescape-core/ios/alerts/EffectsPacks.swift
 */
export type PackSoundSlot = SoundOverrideSlot | 'cue.ride.end'

export type SoundOverrideSlot =
  | 'severity.positive'
  | 'severity.info'
  | 'severity.warning'
  | 'severity.critical'
  | 'cue.on'
  | 'cue.off'
  | 'cue.groupRide.created'
  | 'cue.groupRide.joined'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/MySounds.kt
 * @parity /modules/vescape-core/ios/alerts/MySounds.swift
 */
export interface MySoundsState {
  sounds: { id: string; name: string }[]
  overrides: Partial<Record<SoundOverrideSlot, string>>
}
export const mySounds = (): Promise<MySoundsState> => native.mySounds()
export const importMySound = (uri: string, name: string): Promise<MySoundsState> =>
  native.importMySound(uri, name)
export const renameMySound = (id: string, name: string): Promise<MySoundsState> =>
  native.renameMySound(id, name)
export const deleteMySound = (id: string): Promise<MySoundsState> => native.deleteMySound(id)
export const setSoundOverride = (
  slot: SoundOverrideSlot,
  id: string | null,
): Promise<MySoundsState> => native.setSoundOverride(slot, id)

export const mapTile = (z: number, x: number, y: number): Promise<string | null> =>
  native.mapTile(z, x, y)

export function playPackSound(pack: string, slot: PackSoundSlot): void {
  native.playPackSound(pack, slot)
}

export function startGeigerSimulation(spec: string, rangeDepth: number): void {
  try {
    native.startGeigerSimulation(spec, rangeDepth)
  } catch {}
}

export function stopGeigerSimulation(): void {
  try {
    native.stopGeigerSimulation()
  } catch {}
}

export function startAlertTest(rules: AlertTestRule[]): void {
  try {
    native.startAlertTest(rules)
  } catch {}
}

export function updateAlertTest(value: number): void {
  try {
    native.updateAlertTest(value)
  } catch {}
}

export function stopAlertTest(): void {
  try {
    native.stopAlertTest()
  } catch {}
}

export async function selectBoard(boardId: string): Promise<void> {
  if (E2E_ENABLED) {
    e2eFake.selectBoard(boardId)
    return
  }

  return native.selectBoard(boardId)
}

export async function stopBoard(): Promise<void> {
  if (E2E_ENABLED) {
    e2eFake.stopBoard()
    return
  }

  return native.stopBoard()
}

export function exitApp(): void {
  if (E2E_ENABLED) return
  native.exitApp()
}

export async function probeBoardLink(bleId: string, probeId: string): Promise<BoardProbeResult> {
  if (E2E_ENABLED) {
    return e2eFake.probeBoardLink(bleId, probeId)
  }

  return native.probeBoardLink(bleId, probeId)
}

/**
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `finalizeBoardLink`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `finalizeBoardLink`
 */
export async function finalizeBoardLink(
  probeId: string,
  boardId: string,
  bleId: string,
  candidate: BoardCandidate,
): Promise<BoardLink> {
  if (E2E_ENABLED) return e2eFake.finalizeBoardLink(bleId, candidate)
  return native.finalizeBoardLink(probeId, boardId, bleId, candidate)
}

export function cancelBoardProbe(probeId: string): void {
  if (E2E_ENABLED) return
  native.cancelBoardProbe(probeId)
}

export function setDebugRecordingEnabled(enabled: boolean): void {
  native.setDebugRecordingEnabled(enabled)
}

export async function listDebugRecordings(): Promise<DebugRecording[]> {
  return native.listDebugRecordings()
}

export async function listBundledDebugFixtures(): Promise<DebugFixture[]> {
  return native.listBundledDebugFixtures()
}

export async function exportDebugRecording(name: string): Promise<DatabaseBackupResult> {
  return native.exportDebugRecording(name)
}

export async function deleteDebugRecording(name: string): Promise<void> {
  return native.deleteDebugRecording(name)
}

export async function startDebugReplay(name: string, options?: DebugReplayOptions): Promise<void> {
  return native.startDebugReplay(name, options ?? null)
}

export async function stopDebugReplay(): Promise<void> {
  return native.stopDebugReplay()
}

export function getDebugReplayState(): DebugReplayState | null {
  return native.getDebugReplayState()
}

export function setDebugReplayPaused(paused: boolean): DebugReplayState | null {
  return native.setDebugReplayPaused(paused)
}

export function setDebugReplayLoop(loop: boolean): DebugReplayState | null {
  return native.setDebugReplayLoop(loop)
}

export function dropDebugReplayLink(): DebugReplayState | null {
  return native.dropDebugReplayLink()
}

export function reportUiError(
  message: string,
  source?: string | null,
  stack?: string | null,
): void {
  native.reportUiError(message, source ?? null, stack ?? null)
}

export function reportDiagnosticTest(): DiagnosticStatus {
  return native.reportDiagnosticTest()
}

export function getDiagnosticStatus(): DiagnosticStatus {
  return native.getDiagnosticStatus()
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getPhoneBatteryLevel`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getPhoneBatteryLevel`
 */
export async function getPhoneBatteryLevel(): Promise<number | null> {
  return native.getPhoneBatteryLevel()
}

export function getLiveState(): LiveStateEvent {
  if (E2E_ENABLED) return e2eFake.getLiveState(native.getLiveState())
  return native.getLiveState()
}

export function getAppStatus(): AppStatus | null {
  if (E2E_ENABLED) return null
  return native.getAppStatus()
}

export function getServiceConfig(): ServiceConfig {
  return native.getServiceConfig()
}

export function getWeather(): Weather | null {
  if (E2E_ENABLED) return null
  return native.getWeather()
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getWeatherAlertThresholds`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getWeatherAlertThresholds`
 */
export type WeatherAlertThresholds = Partial<
  Record<WeatherAlertLevel, { gustKmh: number; rainPercent: number }>
>

export function getWeatherAlertThresholds(): WeatherAlertThresholds {
  if (E2E_ENABLED) return {}
  return native.getWeatherAlertThresholds()
}

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
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `openAppUpdate`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `openAppUpdate`
 */
export function openAppUpdate(): void {
  if (E2E_ENABLED) return
  native.openAppUpdate()
}

// @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getRemoteTiltState`
// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getRemoteTiltState`
export async function getRemoteTiltState(): Promise<RemoteTiltState | null> {
  if (E2E_ENABLED) return null
  return native.getRemoteTiltState()
}

/**
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getGroundClearanceTilt`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getGroundClearanceTilt`
 */
export async function getGroundClearanceTilt(): Promise<GroundClearanceTiltState> {
  if (E2E_ENABLED) return { bound: false, driving: false, release: null }
  return native.getGroundClearanceTilt()
}

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

export async function getRideHistoryPage(
  options: RideHistoryPageOptions = {},
): Promise<RideHistoryPage> {
  if (E2E_ENABLED) return e2eFake.getRideHistoryPage(options)
  return native.getRideHistoryPage(options)
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `countRideHistory`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `countRideHistory`
 */
export async function countRideHistory(filter: RideHistoryFilter = {}): Promise<number> {
  if (E2E_ENABLED) return e2eFake.countRideHistory(filter)
  return native.countRideHistory(filter)
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getRideSession`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getRideSession`
 */
export async function getRideSession(id: string): Promise<RideHistorySession | null> {
  if (E2E_ENABLED) return e2eFake.getRideSession(id)
  return native.getRideSession(id)
}

export async function getTelemetrySamples(options: {
  fromMs: number
  toMs: number
  boardId?: string
  limit?: number
}): Promise<TelemetrySample[]> {
  if (E2E_ENABLED) {
    const range = await e2eFake.getHistoryRange(options)
    return decodeBoardSamples(range)
  }
  return native.getTelemetrySamples(options)
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideExport.kt
 * @parity /modules/vescape-core/ios/telemetry/RideExport.swift
 */
export interface RideExportOptions {
  fromMs: number
  toMs: number
  boardId?: string
  name?: string
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideExport.kt
 * @parity /modules/vescape-core/ios/telemetry/RideExport.swift
 */
export interface RideExportFile {
  uri: string
  mimeType: string
  uti: string
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `exportRideGpx`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `exportRideGpx`
 */
export async function exportRideGpx(options: RideExportOptions): Promise<RideExportFile> {
  return native.exportRideGpx(options)
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `exportRideCsv`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `exportRideCsv`
 */
export async function exportRideCsv(options: RideExportOptions): Promise<RideExportFile> {
  return native.exportRideCsv(options)
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `exportRideFloaty`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `exportRideFloaty`
 */
export async function exportRideFloaty(options: RideExportOptions): Promise<RideExportFile> {
  return native.exportRideFloaty(options)
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `exportLiveTelemetryCsv`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `exportLiveTelemetryCsv`
 */
export async function exportLiveTelemetryCsv(): Promise<RideExportFile> {
  return native.exportLiveTelemetryCsv()
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideBatch.kt
 * @parity /modules/vescape-core/ios/telemetry/RideBatch.swift
 */
export type RideSelection =
  { rides: RideExportOptions[] } | { filter: RideHistoryFilter; excludeIds: string[] }

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideBatch.kt `format`
 * @parity /modules/vescape-core/ios/telemetry/RideBatch.swift `format`
 */
export type RideExportFormat = 'gpx' | 'csv' | 'floaty'

export interface RideExportProgressEvent {
  done: number
  total: number
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `registerRideBatch`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `exportRides`
 */
export async function exportRides(
  selection: RideSelection,
  format: RideExportFormat,
): Promise<RideExportFile | null> {
  return native.exportRides({ selection, format })
}

export function cancelRideExport(): void {
  native.cancelRideExport()
}

export function addRideExportProgressListener(
  cb: (event: RideExportProgressEvent) => void,
): EventSubscription {
  return emitter.addListener('onRideExportProgress', cb)
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `registerRideBatch`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `exportRides`
 */
export async function deleteRides(selection: RideSelection): Promise<number> {
  return native.deleteRides(selection)
}

export async function getHistoryRange(options: {
  fromMs: number
  toMs: number
  boardId?: string
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

export async function createFavorite(options: CreateFavoriteOptions): Promise<Favorite> {
  return native.createFavorite(options)
}

export async function updateFavorite(
  id: string,
  options: UpdateFavoriteOptions,
): Promise<Favorite> {
  return native.updateFavorite(id, options)
}

export async function deleteFavorite(id: string): Promise<boolean> {
  return native.deleteFavorite(id)
}

export async function getFavoriteMedia(favoriteId: string): Promise<FavoriteMedia[]> {
  return native.getFavoriteMedia(favoriteId)
}

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

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/notices/RideNoticeEngine.kt `RideNotice`
 * @parity /modules/vescape-core/ios/notices/RideNoticeEngine.swift `RideNotice`
 */
export interface RideNotice {
  id: number
  rev: number
  key: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  details: string
  postedAt: number
  location: { lat: number; lng: number } | null
  expiresAt: number | null
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `emitRideNotices`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `emitRideNotices`
 */
export interface RideNoticesEvent {
  notices: RideNotice[]
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `devPostRideNotice`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `devPostRideNotice`
 */
export interface DevRideNoticeParams {
  key: string
  revision: string
  severity: RideNotice['severity']
  title: string
  details: string
  postedAt: number
  lat?: number
  lng?: number
  expiresAt?: number
}

export function getRideNotices(): RideNotice[] {
  return native.getRideNotices()
}

export function dismissRideNotice(id: number, rev: number): void {
  native.dismissRideNotice(id, rev)
}

export function devPostRideNotice(notice: DevRideNoticeParams): void {
  native.devPostRideNotice(notice)
}

export function devClearRideNotice(key: string): void {
  native.devClearRideNotice(key)
}

export function addRideNoticesListener(cb: (event: RideNoticesEvent) => void): EventSubscription {
  return emitter.addListener('onRideNotices', cb)
}

export async function getBoardWarnings(): Promise<BoardWarning[]> {
  return native.getBoardWarnings()
}

export async function clearBoardWarning(boardId: string, kind: string): Promise<void> {
  return native.clearBoardWarning(boardId, kind)
}

export async function clearAllBoardWarnings(boardId: string): Promise<void> {
  return native.clearAllBoardWarnings(boardId)
}

export async function getBoardConfigValues(): Promise<BoardConfigValues | null> {
  return native.getBoardConfigValues()
}
/**
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getLastKnownBoardConfigValues`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getLastKnownBoardConfigValues`
 */
export async function getLastKnownBoardConfigValues(
  boardId: string,
): Promise<BoardConfigValues | null> {
  return native.getLastKnownBoardConfigValues(boardId)
}

/**
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getMotorConfigValues`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getMotorConfigValues`
 */
export async function getMotorConfigValues(): Promise<MotorConfigValues | null> {
  return native.getMotorConfigValues()
}

/**
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getLastKnownMotorConfigValues`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getLastKnownMotorConfigValues`
 */
export async function getLastKnownMotorConfigValues(
  boardId: string,
): Promise<MotorConfigValues | null> {
  return native.getLastKnownMotorConfigValues(boardId)
}

export async function getBoardConfigChangeNotice(
  boardId: string,
): Promise<BoardConfigChangeNotice | null> {
  return native.getBoardConfigChangeNotice(boardId)
}
export async function dismissBoardConfigChangeNotice(boardId: string): Promise<void> {
  return native.dismissBoardConfigChangeNotice(boardId)
}

/**
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `setBoardConfigChangeFieldIgnored`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setBoardConfigChangeFieldIgnored`
 */
export async function setBoardConfigChangeFieldIgnored(
  boardId: string,
  fieldId: string,
  ignored: boolean,
): Promise<void> {
  return native.setBoardConfigChangeFieldIgnored(boardId, fieldId, ignored)
}

/**
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `clearIgnoredBoardConfigChangeFields`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `clearIgnoredBoardConfigChangeFields`
 */
export async function clearIgnoredBoardConfigChangeFields(boardId: string): Promise<void> {
  return native.clearIgnoredBoardConfigChangeFields(boardId)
}

export async function devInjectBoardWarning(
  boardId: string,
  kind: string,
  severity: BoardWarningSeverity,
  payloadJson: string,
): Promise<void> {
  return native.devInjectBoardWarning(boardId, kind, severity, payloadJson)
}

export async function devReportCleanBoardWarning(boardId: string, kind: string): Promise<void> {
  return native.devReportCleanBoardWarning(boardId, kind)
}

export async function getVescFaults(): Promise<VescFaultOccurrence[]> {
  return native.getVescFaults()
}

export async function setVescFaultDismissed(id: string, dismissed: boolean): Promise<void> {
  return native.setVescFaultDismissed(id, dismissed)
}

export async function getVescFaultCapture(
  occurrenceId: string,
): Promise<VescFaultCaptureDetail | null> {
  return native.getVescFaultCapture(occurrenceId)
}

/**
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `readVescFaultLog`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `readVescFaultLog`
 */
export async function readVescFaultLog(boardId: string): Promise<string> {
  return native.readVescFaultLog(boardId)
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

// @parity /modules/vescape-core/ios/VescapeCoreModule.swift `setRemoteTilt`
// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setRemoteTilt`
export async function setRemoteTilt(value: number): Promise<boolean> {
  if (E2E_ENABLED) return true
  return native.setRemoteTilt(value)
}

// @parity /modules/vescape-core/ios/VescapeCoreModule.swift `lockRemoteTilt`
// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `lockRemoteTilt`
export async function lockRemoteTilt(value: number): Promise<boolean> {
  if (E2E_ENABLED) return true
  return native.lockRemoteTilt(value)
}

// @parity /modules/vescape-core/ios/VescapeCoreModule.swift `releaseRemoteTilt`
// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `releaseRemoteTilt`
export async function releaseRemoteTilt(value: number, durationMs: number): Promise<boolean> {
  if (E2E_ENABLED) return true
  return native.releaseRemoteTilt(value, durationMs)
}

// @parity /modules/vescape-core/ios/VescapeCoreModule.swift `stopRemoteTilt`
// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `stopRemoteTilt`
export async function stopRemoteTilt(): Promise<boolean> {
  if (E2E_ENABLED) return true
  return native.stopRemoteTilt()
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `lightsEventBody`
 * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `lightsEventBody`
 */
export interface BoardLightsEvent {
  enabled: boolean | null
  headlightsEnabled: boolean | null
}

export async function setBoardLights(
  enabled: boolean,
  headlightsEnabled: boolean,
): Promise<boolean> {
  if (E2E_ENABLED) return true
  return native.setBoardLights(enabled, headlightsEnabled)
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescProtocol.kt `buildBoardMoveCommand`
 * @parity /modules/vescape-core/ios/protocol/VescProtocol.swift `buildBoardMoveCommand`
 */
export async function startBoardMove(input: number): Promise<boolean> {
  if (E2E_ENABLED) return true
  return native.startBoardMove(input)
}

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

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `pushProfileToBoard`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `pushProfileToBoard`
 */
export async function pushProfileToBoard(
  profileId: string,
  fieldIds: string[],
): Promise<RefloatConfigSnapshot> {
  return native.pushProfileToBoard(profileId, fieldIds)
}

export async function getProfileStatsSnapshot(
  options?: ProfileStatsSnapshotOptions,
): Promise<ProfileStatsSnapshot> {
  return native.getProfileStatsSnapshot(options ?? {})
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/ProfileStatsRepositoryAndroid.kt `getDayStats`
 * @parity /modules/vescape-core/ios/telemetry/ProfileStatsRepository.swift `getDayStats`
 */
export async function getDayStats(day: RideDay): Promise<ProfileStats> {
  return native.getDayStats(day)
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/ProfileStatsRepositoryAndroid.kt `getRecentRideStats`
 * @parity /modules/vescape-core/ios/telemetry/ProfileStatsRepository.swift `getRecentRideStats`
 */
export async function getRecentRideStats(sinceMs: number): Promise<ProfileStats> {
  return native.getRecentRideStats(sinceMs)
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getMaintenanceState`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getMaintenanceState`
 */
export function getMaintenanceState(): MaintenanceState {
  return native.getMaintenanceState()
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

export async function upsertBoard(
  board: BoardInput,
  initialAlerts?: InitialBoardAlerts,
): Promise<void> {
  if (E2E_ENABLED) {
    e2eFake.upsertBoard(board)
    return
  }
  return native.upsertBoard(
    board,
    initialAlerts
      ? { presets: initialAlerts.presets, rules: initialAlerts.rules.map(bridgeableAlertRule) }
      : null,
  )
}

export async function deleteBoard(id: string): Promise<void> {
  return native.deleteBoard(id)
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `applyAlertPreset`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `applyAlertPreset`
 */
export type AlertPresetMetric = 'battery' | 'speed' | 'duty' | 'motor-temp' | 'controller-temp'
export type AlertPresetLevel = 'off' | 'safe' | 'normal' | 'minimal'

export type AlertPresetIntent =
  { level: AlertPresetLevel } | { geiger: 'soft' | 'mid' | 'hard' } | { match: boolean }

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `previewAlertPreset`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `previewAlertPreset`
 */
export function previewAlertPreset(
  metric: AlertPresetMetric,
  spec: string,
  options: {
    topSpeedKmh: number
    hasBatteryConfig: boolean
    distanceUnit?: DistanceUnit
  },
): AlertTestRule[] {
  return native.previewAlertPreset(
    metric,
    spec,
    options.topSpeedKmh,
    options.hasBatteryConfig,
    options.distanceUnit ?? 'km',
  )
}

export async function applyAlertPreset(
  boardId: string,
  metric: AlertPresetMetric,
  intent: AlertPresetIntent,
): Promise<void> {
  return native.applyAlertPreset(
    boardId,
    metric,
    'level' in intent ? intent.level : null,
    'geiger' in intent ? intent.geiger : null,
    'match' in intent ? intent.match : null,
  )
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getAlertPresets`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getAlertPresets`
 */
export async function getAlertPresets(boardId: string): Promise<Record<AlertPresetMetric, string>> {
  return native.getAlertPresets(boardId)
}

export async function getAlertRules(boardId: string): Promise<AlertRule[]> {
  return native.getAlertRules(boardId)
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `toAlertRuleEntity`
 * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `upsertAlertRule`
 */
function bridgeableAlertRule(rule: AlertRule): AlertRule {
  const thresholdRule = rule.thresholdRule
  if (!thresholdRule || thresholdRule.kind !== 'config-relative') return rule
  const { thresholdMaxOffset, ...rest } = thresholdRule
  if (thresholdMaxOffset != null) return rule
  return { ...rule, thresholdRule: rest as AlertRule['thresholdRule'] }
}

export async function upsertAlertRule(rule: AlertRule): Promise<void> {
  return native.upsertAlertRule(bridgeableAlertRule(rule))
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

export async function searchMap(
  query: string,
  limit: number,
  proximity: string | null,
): Promise<string> {
  return native.searchMap(query, limit, proximity)
}

export async function reverseGeocodeMap(latitude: number, longitude: number): Promise<string> {
  return native.reverseGeocodeMap(latitude, longitude)
}

export async function getRiderProfile(): Promise<RiderProfile | null> {
  return native.getRiderProfile()
}

export async function saveRiderProfile(
  nick: string,
  nationality: string | null,
): Promise<RiderProfile> {
  return native.saveRiderProfile(nick, nationality)
}

export async function searchRiders(prefix: string): Promise<RiderProfile[]> {
  return native.searchRiders(prefix)
}

export async function getRider(accountId: string): Promise<RiderDetail | null> {
  return native.getRider(accountId)
}

export async function getFriends(): Promise<Friends> {
  return native.getFriends()
}

export async function sendFriendRequest(accountId: string): Promise<FriendRequestStatus> {
  return native.sendFriendRequest(accountId)
}

export async function acceptFriendRequest(accountId: string): Promise<void> {
  return native.acceptFriendRequest(accountId)
}

export async function deleteFriendRequest(accountId: string): Promise<void> {
  return native.deleteFriendRequest(accountId)
}

export async function removeFriend(accountId: string): Promise<void> {
  return native.removeFriend(accountId)
}

export async function getRodeWith(from: string, to: string): Promise<RodeWithCrewRide[]> {
  return native.getRodeWith(from, to)
}

/**
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `getFriendRides`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `getFriendRides`
 */
export async function getFriendRides(
  accountId: string,
  limit?: number,
  before?: string,
): Promise<FriendRidesPage> {
  return native.getFriendRides(accountId, limit ?? null, before ?? null)
}

export async function getFriendRideTrack(
  accountId: string,
  from: string,
  to: string,
): Promise<PublicTrackPoint[]> {
  return native.getFriendRideTrack(accountId, from, to)
}

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

export async function setMapPointReaction(
  id: string,
  reaction: MapPointReaction | null,
): Promise<void> {
  return native.setMapPointReaction(id, reaction)
}

export async function setDirectionPoint(
  latitude: number | null,
  longitude: number | null,
): Promise<void> {
  return native.setDirectionPoint(latitude, longitude)
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `recomputeNavigation`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `recomputeNavigation`
 */
export async function recomputeNavigation(): Promise<void> {
  return native.recomputeNavigation()
}

/**
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

export function addDeviceListener(cb: (event: DeviceFoundEvent) => void): EventSubscription {
  if (FAKE_SCAN) {
    return e2eFake.addDeviceListener(cb)
  }

  return emitter.addListener('onDevice', cb)
}

export function addAccessoryDeviceListener(
  cb: (event: AccessoryDeviceEvent) => void,
): EventSubscription {
  return emitter.addListener('onAccessoryDevice', cb)
}

export function addAccessoryScanErrorListener(
  cb: (event: AccessoryScanErrorEvent) => void,
): EventSubscription {
  return emitter.addListener('onAccessoryScanError', cb)
}

export function addAccessoryStateListener(
  cb: (event: AccessoryStateEvent) => void,
): EventSubscription {
  return emitter.addListener('onAccessoryState', cb)
}

export function addAccessoryReadingListener(
  cb: (event: AccessoryReadingEvent) => void,
): EventSubscription {
  return emitter.addListener('onAccessoryReading', cb)
}

export function addErrorListener(cb: (event: ErrorEvent) => void): EventSubscription {
  return emitter.addListener('onError', cb)
}

export function addAppDataChangedListener(
  cb: (event: AppDataChangedEvent) => void,
): EventSubscription {
  return emitter.addListener('onAppDataChanged', cb)
}

export function addVescFaultsListener(cb: (event: VescFaultsEvent) => void): EventSubscription {
  return emitter.addListener('onVescFaults', cb)
}

export function addBoardWarningsListener(
  cb: (event: BoardWarningsEvent) => void,
): EventSubscription {
  return emitter.addListener('onBoardWarnings', cb)
}

export function addBoardConfigValuesListener(
  cb: (event: BoardConfigValuesEvent) => void,
): EventSubscription {
  return emitter.addListener('onBoardConfigValues', cb)
}
export function addMotorConfigValuesListener(
  cb: (event: MotorConfigValuesEvent) => void,
): EventSubscription {
  return emitter.addListener('onMotorConfigValues', cb)
}
export function addBoardConfigChangeNoticeListener(
  cb: (event: BoardConfigChangeNoticeEvent) => void,
): EventSubscription {
  return emitter.addListener('onBoardConfigChangeNotice', cb)
}

export function addBoardLightsListener(cb: (event: BoardLightsEvent) => void): EventSubscription {
  return emitter.addListener('onBoardLights', cb)
}

export function addAppStatusListener(cb: (event: AppStatusEvent) => void): EventSubscription {
  return emitter.addListener('onAppStatus', cb)
}

export function addServiceConfigListener(
  cb: (event: ServiceConfigEvent) => void,
): EventSubscription {
  return emitter.addListener('onServiceConfig', cb)
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
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setWatchRouteSpanM`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `setWatchRouteSpanM`
 */
export function setWatchRouteSpanM(spanM: number | null): void {
  native.setWatchRouteSpanM(spanM)
}

export function addMaintenanceStateListener(
  cb: (event: MaintenanceState) => void,
): EventSubscription {
  return emitter.addListener('onMaintenanceState', cb)
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

export function addGroupRideErrorListener(
  cb: (event: GroupRideErrorEvent) => void,
): EventSubscription {
  return emitter.addListener('onGroupRideError', cb)
}

export function addGroupRideSignalAvailabilityListener(
  cb: (event: GroupRideSignalAvailability) => void,
): EventSubscription {
  return emitter.addListener('onGroupRideSignalAvailability', cb)
}

export function addPublicRideStatusListener(
  cb: (event: PublicRideStatus) => void,
): EventSubscription {
  return emitter.addListener('onPublicRideStatus', cb)
}

export function addPublicRidersListener(cb: (event: PublicRidersEvent) => void): EventSubscription {
  return emitter.addListener('onPublicRiders', cb)
}

export function addPublicPinsListener(cb: (event: PublicPinsEvent) => void): EventSubscription {
  return emitter.addListener('onPublicPins', cb)
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `saveBrakeLightSettings`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `saveBrakeLightSettings`
 */
export function saveBrakeLightSettings(
  accessoryId: string,
  capabilityId: string,
  settings: BrakeLightSettings,
): Promise<boolean> {
  return native.saveBrakeLightSettings(
    accessoryId,
    capabilityId,
    settings.sensitivity,
    settings.parked,
  )
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setAccessoryCapabilityEnabled`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `setAccessoryCapabilityEnabled`
 */
export function setAccessoryCapabilityEnabled(
  accessoryId: string,
  capabilityId: string,
  enabled: boolean,
): Promise<boolean> {
  return native.setAccessoryCapabilityEnabled(accessoryId, capabilityId, enabled)
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setAccessorySamplingRate`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `setAccessorySamplingRate`
 */
export function setAccessorySamplingRate(
  accessoryId: string,
  capabilityId: string,
  rateHz: number,
): Promise<boolean> {
  return native.setAccessorySamplingRate(accessoryId, capabilityId, rateHz)
}
/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `setBrakeLightPreview`
 * @parity /modules/vescape-core/ios/VescapeCoreModule.swift `setBrakeLightPreview`
 */
export function setBrakeLightPreview(
  accessoryId: string,
  capabilityId: string,
  mode: BrakeLightMode | null,
): Promise<boolean> {
  return native.setBrakeLightPreview(accessoryId, capabilityId, mode)
}
