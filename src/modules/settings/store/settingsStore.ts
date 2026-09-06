import { dequal } from 'dequal'
import { create } from 'zustand'
import {
  addCompanionPresenceBoard,
  getCompanionPresenceBoards,
  getSettings,
  removeCompanionPresenceBoard,
  setCompanionPresenceEnabled,
  updateSetting,
  type AppSettings,
  type CompanionPresenceBoard,
} from 'vescape-core'
import { DEFAULT_HISTORY_METRIC_HOT_RANGES } from '@/modules/history/lib/metricColorScale'
import { DEFAULT_RIDE_SPLIT_GAP_MINUTES } from '@/modules/history/lib/sessions'
import {
  DEFAULT_SATELLITE_IMAGERY_OPACITY,
  DEFAULT_SATELLITE_MAP_IMAGERY_OPACITY,
  DEFAULT_SATELLITE_IMAGERY_SATURATION,
} from '@/modules/map/constants/satelliteDarkMapStyle'

const DEFAULTS: AppSettings = {
  liveHistoryLimit: 5,
  autoConnect: true,
  autoRecording: true,
  selectedBoardId: null,
  lastGpsLatitude: null,
  lastGpsLongitude: null,
  directionPointLatitude: null,
  directionPointLongitude: null,
  movingSpeedThresholdKmh: 3,
  freeSpinMaxSpeedDeltaKmh: 12,
  freeSpinStationaryBoardCapKmh: 15,
  rideSplitGapMinutes: DEFAULT_RIDE_SPLIT_GAP_MINUTES,
  themeMode: 'system',
  mapStyleKey: 'onedark',
  satelliteOverlayEnabled: true,
  satelliteImageryOpacity: DEFAULT_SATELLITE_IMAGERY_OPACITY,
  satelliteMapImageryOpacity: DEFAULT_SATELLITE_MAP_IMAGERY_OPACITY,
  satelliteImagerySaturation: DEFAULT_SATELLITE_IMAGERY_SATURATION,
  hideTelemetryMapDetails: true,
  mapOrientationMode: 'northUp',
  historyMetricGradientsEnabled: true,
  historyMetricHotRanges: DEFAULT_HISTORY_METRIC_HOT_RANGES,
  socEstimateWindowSeconds: 20,
  boardMoveStrengthPercent: 60,
  connectionSoundsEnabled: true,
  companionPresenceEnabled: false,
  boardWarningsEnabled: true,
  vescFaultCollectionEnabled: true,
  companionPresenceCooldownMinutes: 60,
  autoCloseEnabled: false,
  autoCloseDelayMinutes: 15,
  telemetryPollRateHz: 20,
  wearPushRateHz: 4,
  wearAutoLaunchOnConnect: true,
  wearNavArrowEnabled: false,
  riderId: null,
  riderName: null,
  riderColor: null,
  legalPolicy: null,
  dismissedCommunityMessageIds: [],
}

interface SettingsState extends AppSettings {
  loaded: boolean
  loadError: string | null
  companionPresenceBoards: CompanionPresenceBoard[]
  load: () => Promise<void>
  set: <K extends Exclude<keyof AppSettings, 'legalPolicy'>>(
    key: K,
    value: AppSettings[K],
  ) => Promise<void>
  setCompanionPresence: (enabled: boolean) => Promise<void>
  addCompanionBoard: (boardId: string) => Promise<void>
  removeCompanionBoard: (boardId: string) => Promise<void>
}

export function useLiveWindowMs(): number {
  return useSettingsStore((s) => s.liveHistoryLimit) * 60_000
}

export function getLiveWindowMs(): number {
  return useSettingsStore.getState().liveHistoryLimit * 60_000
}

function assertSettingsAvailable(loaded: boolean): void {
  if (!loaded) throw new Error('Settings are unavailable')
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  loaded: false,
  loadError: null,
  companionPresenceBoards: [],

  async load() {
    try {
      const [s, companionPresenceBoards] = await Promise.all([
        getSettings(),
        getCompanionPresenceBoards(),
      ])
      const next: AppSettings = {
        ...s,
        autoConnect: s.companionPresenceEnabled ? true : s.autoConnect,
      }
      // Reloads can fire often (e.g. the 30s GPS write emits `settings`). Set only the keys that
      // actually changed so untouched selectors don't re-render, and bail entirely when nothing did.
      const prev = get()
      const patch: Partial<SettingsState> = {}
      for (const key of Object.keys(next) as (keyof AppSettings)[]) {
        if (!dequal(prev[key], next[key])) patch[key] = next[key] as never
      }
      if (!dequal(prev.companionPresenceBoards, companionPresenceBoards)) {
        patch.companionPresenceBoards = companionPresenceBoards
      }
      if (!prev.loaded) patch.loaded = true
      if (prev.loadError) patch.loadError = null
      if (Object.keys(patch).length > 0) set(patch)
    } catch {
      set({
        loaded: false,
        loadError: 'Settings could not be read. Restart Vescape before changing settings.',
      })
    }
  },

  async set(key, value) {
    assertSettingsAvailable(get().loaded)
    if (key === 'autoConnect' && value === false && get().companionPresenceEnabled) return
    await updateSetting(key, value)
    set({ [key]: value })
  },

  async setCompanionPresence(enabled) {
    assertSettingsAvailable(get().loaded)
    await setCompanionPresenceEnabled(enabled)
    const companionPresenceBoards = await getCompanionPresenceBoards()
    set({
      companionPresenceEnabled: enabled,
      companionPresenceBoards,
      ...(enabled ? { autoConnect: true } : {}),
    })
  },

  async addCompanionBoard(boardId) {
    assertSettingsAvailable(get().loaded)
    await addCompanionPresenceBoard(boardId)
    const companionPresenceBoards = await getCompanionPresenceBoards()
    set({ companionPresenceBoards, companionPresenceEnabled: companionPresenceBoards.length > 0 })
  },

  async removeCompanionBoard(boardId) {
    assertSettingsAvailable(get().loaded)
    await removeCompanionPresenceBoard(boardId)
    const companionPresenceBoards = await getCompanionPresenceBoards()
    set({ companionPresenceBoards })
  },
}))
