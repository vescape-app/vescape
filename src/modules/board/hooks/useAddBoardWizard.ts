import { useMemo, useState } from 'react'
import { router } from 'expo-router'
import { useShallow } from 'zustand/react/shallow'
import type { BatteryConfig, BoardLink } from 'vescape-core'

import {
  ALERT_PRESET_FALLBACK_LEVEL,
  ALERT_PRESET_METRICS,
  type AlertPresetMetric,
} from '@/modules/alerts/lib/alertPresets'
import type { DraftAlertSetup } from '@/modules/alerts/hooks/useMetricAlerts'
import { formatAlertPresetSpec } from '@/modules/alerts/lib/alertSoundString'
import { DEFAULT_BOARD_TOP_SPEED_KMH } from '@/modules/alerts/lib/boardAlertSettings'
import { useAlertsStore } from '@/modules/alerts/store/alertsStore'
import { DEFAULT_BATTERY_CONFIG, deriveBatteryConfig } from '@/modules/battery/lib'
import type { DerivedBatteryConfig } from '@/modules/battery/lib/types'
import {
  type BatteryMode,
  type BatterySummary,
  buildBatteryConfig,
  getBatterySummary,
  parseVoltage,
} from '@/modules/board/lib/boardSetup'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { generateId } from '@/helpers/id'
import type { RailColorId } from '@/modules/board/components/add-board-wizard/BoardColorPicker'
import type { RailId } from '@/modules/board/lib/railPresets'
import { getBoardPreset, getCustomRailOption } from '@/modules/board/lib/boardPresets'

/** The wizard's buffered alert setup for every preset metric, flushed onto the Board on save. */
export type DraftAlertSetupBag = Record<AlertPresetMetric, DraftAlertSetup>

const DEFAULT_DRAFT_ALERT_SETUP = Object.fromEntries(
  ALERT_PRESET_METRICS.map((metric): [AlertPresetMetric, DraftAlertSetup] => [
    metric,
    { level: ALERT_PRESET_FALLBACK_LEVEL, rules: [] },
  ]),
) as DraftAlertSetupBag

/** Canonical step order. `presets` is the per-board Alert Preset setup step. */
export const WIZARD_STEPS = ['scan', 'name', 'battery', 'presets', 'confirm'] as const
export type WizardStepId = (typeof WIZARD_STEPS)[number]

/** Sub-phase of the Pair step: choosing a peripheral, or probing the chosen one. */
type PairPhase = 'select' | 'probing'

interface AddBoardWizardState {
  boardId: string
  step: number
  stepId: WizardStepId
  /** Active steps for this run. */
  steps: readonly WizardStepId[]
  pairPhase: PairPhase
  bleId: string
  bleName: string
  draftLink: BoardLink | null
  name: string
  description: string
  railId: RailId
  railColorId: RailColorId
  boardPresetId: string | null
  customRailOptionId: string | null
  batteryMode: BatteryMode
  cellPresetId: string
  seriesCount: number
  parallelCount: number
  manualMinVoltage: string
  manualMaxVoltage: string
  batteryWarning: string | null
  batterySummary: BatterySummary
  /** Draft Board Top Speed + per-metric alert setup, persisted to the new Board on save. */
  topSpeedKmh: number
  alertSetup: DraftAlertSetupBag
  /** True when the draft battery config is usable (gates SoC %-based presets). */
  hasBatteryConfig: boolean
  /** The draft's derived battery config when valid, for SoC %-scaled battery rules. */
  batteryConfig: DerivedBatteryConfig | null
  canSave: boolean
}

interface AddBoardWizardActions {
  setStep: (step: number) => void
  next: () => void
  back: () => void
  selectDevice: (id: string, deviceName: string) => void
  clearDevice: () => void
  onDeviceProbed: (link: BoardLink) => void
  continueOffline: () => void
  setName: (v: string) => void
  setDescription: (v: string) => void
  setRailId: (v: RailId) => void
  setRailColorId: (v: RailColorId) => void
  selectBoardPreset: (id: string) => void
  selectCustomRail: (id: string) => void
  enterCustomBuild: () => void
  setBatteryMode: (v: BatteryMode) => void
  setCellPresetId: (v: string) => void
  setSeriesCount: (v: number) => void
  setParallelCount: (v: number) => void
  setManualMinVoltage: (v: string) => void
  setManualMaxVoltage: (v: string) => void
  setTopSpeedKmh: (v: number) => void
  setAlertSetup: (metric: AlertPresetMetric, setup: DraftAlertSetup) => void
  save: () => Promise<void>
}

export type UseAddBoardWizard = AddBoardWizardState & AddBoardWizardActions

export function useAddBoardWizard(): UseAddBoardWizard {
  const { addBoard, setActiveBoard } = useBoardStore(
    useShallow((s) => ({ addBoard: s.addBoard, setActiveBoard: s.setActiveBoard })),
  )

  // Alert setup is per-board now (#254), so every new board gets its own guided preset step.
  const steps = WIZARD_STEPS

  const [step, setStep] = useState(0)
  const [boardId] = useState(generateId)
  const [pairPhase, setPairPhase] = useState<PairPhase>('select')
  const [bleId, setBleId] = useState('')
  const [bleName, setBleName] = useState('')
  const [draftLink, setDraftLink] = useState<BoardLink | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [railId, setRailId] = useState<RailId>('xr')
  const [railColorId, setRailColorId] = useState<RailColorId>('cyan')
  const [boardPresetId, setBoardPresetId] = useState<string | null>(null)
  const [customRailOptionId, setCustomRailOptionId] = useState<string | null>(null)
  const [batteryMode, setBatteryMode] = useState<BatteryMode>(DEFAULT_BATTERY_CONFIG.mode)
  const [cellPresetId, setCellPresetId] = useState(DEFAULT_BATTERY_CONFIG.cellPresetId)
  const [seriesCount, setSeriesCount] = useState(DEFAULT_BATTERY_CONFIG.seriesCount)
  const [parallelCount, setParallelCount] = useState(DEFAULT_BATTERY_CONFIG.parallelCount)
  const [manualMinVoltage, setManualMinVoltage] = useState('60')
  const [manualMaxVoltage, setManualMaxVoltage] = useState('84')
  const [topSpeedKmh, setTopSpeedKmh] = useState(DEFAULT_BOARD_TOP_SPEED_KMH)
  const [alertSetup, setAlertSetup] = useState<DraftAlertSetupBag>(DEFAULT_DRAFT_ALERT_SETUP)

  const setMetricAlertSetup = (metric: AlertPresetMetric, setup: DraftAlertSetup) =>
    setAlertSetup((prev) => ({ ...prev, [metric]: setup }))

  const selectBoardPreset = (id: string) => {
    const preset = getBoardPreset(id)
    if (!preset) return
    setBoardPresetId(id)
    setCustomRailOptionId(null)
    setRailId(preset.railId)
    const battery = preset.batteryConfig
    const derived = deriveBatteryConfig(battery)
    setBatteryMode('preset')
    setCellPresetId(battery.cellPresetId)
    setSeriesCount(battery.seriesCount)
    setParallelCount(battery.parallelCount)
    setManualMinVoltage(String(derived.minVoltage))
    setManualMaxVoltage(String(derived.maxVoltage))
  }

  const enterCustomBuild = () => {
    if (boardPresetId !== null) {
      setBatteryMode(DEFAULT_BATTERY_CONFIG.mode)
      setCellPresetId(DEFAULT_BATTERY_CONFIG.cellPresetId)
      setSeriesCount(DEFAULT_BATTERY_CONFIG.seriesCount)
      setParallelCount(DEFAULT_BATTERY_CONFIG.parallelCount)
    }
    setBoardPresetId(null)
    setRailId(getCustomRailOption(customRailOptionId)?.railId ?? 'xr')
  }

  const selectCustomRail = (id: string) => {
    const option = getCustomRailOption(id)
    if (!option) return
    setCustomRailOptionId(id)
    setBoardPresetId(null)
    setRailId(option.railId)
  }

  // Memoized on the draft inputs so draft alert controllers only rebuild when the battery changes.
  const derivedBattery = useMemo(() => {
    const previewConfig: BatteryConfig =
      batteryMode === 'preset'
        ? { mode: 'preset', cellPresetId, seriesCount, parallelCount }
        : {
            mode: 'manual',
            minVoltage: parseVoltage(manualMinVoltage) ?? 0,
            maxVoltage: parseVoltage(manualMaxVoltage) ?? 0,
          }
    return deriveBatteryConfig(previewConfig)
  }, [batteryMode, cellPresetId, seriesCount, parallelCount, manualMinVoltage, manualMaxVoltage])
  const batteryWarning = derivedBattery.warning
  const hasBatteryConfig = batteryWarning == null
  const draftBatteryConfig = hasBatteryConfig ? derivedBattery : null
  const canSave = Boolean(name.trim()) && batteryWarning == null
  const batterySummary = getBatterySummary(
    false,
    derivedBattery,
    batteryMode,
    cellPresetId,
    seriesCount,
    parallelCount,
  )

  const next = () => setStep((s) => Math.min(s + 1, steps.length - 1))
  const back = () => setStep((s) => Math.max(s - 1, 0))

  // Selecting a peripheral starts a Board Probe before the rest of the wizard.
  const selectDevice = (id: string, deviceName: string) => {
    setBleId(id)
    setBleName(deviceName)
    if (!name.trim()) setName(deviceName)
    setDraftLink(null)
    setPairPhase('probing')
  }

  // Drop the chosen peripheral and return to the device list.
  const clearDevice = () => {
    setBleId('')
    setBleName('')
    setDraftLink(null)
    setPairPhase('select')
  }

  // A successful probe yields a draft Board Link; advance to the rest of setup.
  const onDeviceProbed = (link: BoardLink) => {
    setDraftLink(link)
    setPairPhase('select')
    next()
  }

  // Explicit offline path: create the Board with no Board Link.
  const continueOffline = () => {
    clearDevice()
    next()
  }

  const save = async () => {
    if (!canSave) return
    const batteryConfig = buildBatteryConfig(
      batteryMode,
      cellPresetId,
      seriesCount,
      parallelCount,
      manualMinVoltage,
      manualMaxVoltage,
    )
    // Each draft level becomes the Board's preset row, saved with its draft rider rules, so no
    // session ever sees the Board on the default presets.
    const presets = Object.fromEntries(
      ALERT_PRESET_METRICS.map((metric) => {
        const { level } = alertSetup[metric]
        return [metric, formatAlertPresetSpec({ level, options: [] })]
      }),
    )
    const rules = Object.values(alertSetup).flatMap((setup) =>
      setup.rules.map((rule) => ({ ...rule, boardId })),
    )
    const board = await addBoard({
      id: boardId,
      name: name.trim(),
      description: description.trim() || undefined,
      personalization: { railId, railColorId },
      link: draftLink,
      batteryConfig,
      topSpeedKmh,
      alertPresetsOnboarded: true,
      alerts: { presets, rules },
    })
    setActiveBoard(board.id)
    await useAlertsStore.getState().load(board.id)
    router.dismissAll()
  }

  return {
    boardId,
    step,
    stepId: steps[step] ?? steps[steps.length - 1]!,
    steps,
    pairPhase,
    bleId,
    bleName,
    draftLink,
    name,
    description,
    railId,
    railColorId,
    boardPresetId,
    customRailOptionId,
    batteryMode,
    cellPresetId,
    seriesCount,
    parallelCount,
    manualMinVoltage,
    manualMaxVoltage,
    batteryWarning,
    batterySummary,
    topSpeedKmh,
    alertSetup,
    hasBatteryConfig,
    batteryConfig: draftBatteryConfig,
    canSave,
    setStep,
    next,
    back,
    selectDevice,
    clearDevice,
    onDeviceProbed,
    continueOffline,
    setName,
    setDescription,
    setRailId,
    setRailColorId,
    selectBoardPreset,
    selectCustomRail,
    enterCustomBuild,
    setBatteryMode,
    setCellPresetId,
    setSeriesCount,
    setParallelCount,
    setManualMinVoltage,
    setManualMaxVoltage,
    setTopSpeedKmh,
    setAlertSetup: setMetricAlertSetup,
    save,
  }
}
