import { useState } from 'react'
import { router } from 'expo-router'
import { useShallow } from 'zustand/react/shallow'
import type { BatteryConfig, BoardKind, BoardLink } from 'vescape-core'

import {
  ALERT_PRESET_METRICS,
  NEW_BOARD_ALERT_PRESET_SELECTION,
  type AlertPresetMetric,
  type AlertPresetSelection,
} from '@/modules/alerts/lib/alertPresets'
import { type DraftAlertSetup } from '@/modules/alerts/hooks/useMetricAlerts'
import { DEFAULT_BOARD_TOP_SPEED_KMH } from '@/modules/alerts/lib/boardAlertSettings'
import { useAlertPresetStore } from '@/modules/alerts/store/alertPresetStore'
import { useAlertsStore } from '@/modules/alerts/store/alertsStore'
import { DEFAULT_BATTERY_CONFIG, deriveBatteryConfig } from '@/modules/battery/lib'
import {
  type BatteryMode,
  type BatterySummary,
  buildBatteryConfig,
  getBatterySummary,
  parseVoltage,
} from '@/modules/board/lib/boardSetup'
import { useBoardStore } from '@/modules/board/store/boardStore'

/** The wizard's buffered alert setup for every preset metric, flushed onto the Board on save. */
export type DraftAlertSetupBag = Record<AlertPresetMetric, DraftAlertSetup>

const DEFAULT_DRAFT_ALERT_SETUP = Object.fromEntries(
  ALERT_PRESET_METRICS.map((metric): [AlertPresetMetric, DraftAlertSetup] => [
    metric,
    { level: NEW_BOARD_ALERT_PRESET_SELECTION[metric], rules: [] },
  ]),
) as DraftAlertSetupBag

/** The durable `alertPreset` bag a draft setup persists as — its levels, without the draft rules. */
export function draftAlertPresetSelection(setup: DraftAlertSetupBag): AlertPresetSelection {
  return Object.fromEntries(
    ALERT_PRESET_METRICS.map((metric) => [metric, setup[metric].level]),
  ) as AlertPresetSelection
}

/** Canonical step order. `presets` is the per-board Alert Preset setup step. */
export const WIZARD_STEPS = ['scan', 'name', 'battery', 'presets', 'confirm'] as const
export type WizardStepId = (typeof WIZARD_STEPS)[number]

/** Sub-phase of the Pair step: choosing a peripheral, or probing the chosen one. */
type PairPhase = 'select' | 'probing' | 'onewheel'

interface AddBoardWizardState {
  step: number
  stepId: WizardStepId
  /** Active steps for this run. */
  steps: readonly WizardStepId[]
  pairPhase: PairPhase
  boardKind: BoardKind
  bleId: string
  bleName: string
  draftLink: BoardLink | null
  name: string
  description: string
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
  canSave: boolean
}

interface AddBoardWizardActions {
  setStep: (step: number) => void
  next: () => void
  back: () => void
  selectDevice: (id: string, deviceName: string) => void
  selectOneWheel: (id: string, deviceName: string) => void
  onOneWheelReady: () => void
  clearDevice: () => void
  onDeviceProbed: (link: BoardLink) => void
  continueOffline: () => void
  setName: (v: string) => void
  setDescription: (v: string) => void
  setBatteryMode: (v: BatteryMode) => void
  setCellPresetId: (v: string) => void
  setSeriesCount: (v: number) => void
  setParallelCount: (v: number) => void
  setManualMinVoltage: (v: string) => void
  setManualMaxVoltage: (v: string) => void
  setTopSpeedKmh: (v: number) => void
  setAlertSetup: (metric: AlertPresetMetric, setup: DraftAlertSetup) => void
  save: () => void
}

export type UseAddBoardWizard = AddBoardWizardState & AddBoardWizardActions

export function useAddBoardWizard(): UseAddBoardWizard {
  const { addBoard, setActiveBoard } = useBoardStore(
    useShallow((s) => ({ addBoard: s.addBoard, setActiveBoard: s.setActiveBoard })),
  )

  const [step, setStep] = useState(0)
  const [pairPhase, setPairPhase] = useState<PairPhase>('select')
  const [boardKind, setBoardKind] = useState<BoardKind>('vesc')
  const [bleId, setBleId] = useState('')
  const [bleName, setBleName] = useState('')
  const [draftLink, setDraftLink] = useState<BoardLink | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [batteryMode, setBatteryMode] = useState<BatteryMode>(DEFAULT_BATTERY_CONFIG.mode)
  const [cellPresetId, setCellPresetId] = useState(DEFAULT_BATTERY_CONFIG.cellPresetId)
  const [seriesCount, setSeriesCount] = useState(DEFAULT_BATTERY_CONFIG.seriesCount)
  const [parallelCount, setParallelCount] = useState(DEFAULT_BATTERY_CONFIG.parallelCount)
  const [manualMinVoltage, setManualMinVoltage] = useState('60')
  const [manualMaxVoltage, setManualMaxVoltage] = useState('84')
  const [topSpeedKmh, setTopSpeedKmh] = useState(DEFAULT_BOARD_TOP_SPEED_KMH)
  const [alertSetup, setAlertSetup] = useState<DraftAlertSetupBag>(DEFAULT_DRAFT_ALERT_SETUP)

  // Future Motion reports SoC directly, so original OneWheels do not need voltage-pack setup.
  const steps =
    boardKind === 'onewheel' ? (['scan', 'name', 'presets', 'confirm'] as const) : WIZARD_STEPS

  const setMetricAlertSetup = (metric: AlertPresetMetric, setup: DraftAlertSetup) =>
    setAlertSetup((prev) => ({ ...prev, [metric]: setup }))

  const previewConfig: BatteryConfig =
    batteryMode === 'preset'
      ? { mode: 'preset', cellPresetId, seriesCount, parallelCount }
      : {
          mode: 'manual',
          minVoltage: parseVoltage(manualMinVoltage) ?? 0,
          maxVoltage: parseVoltage(manualMaxVoltage) ?? 0,
        }
  const derivedBattery = deriveBatteryConfig(previewConfig)
  const batteryWarning = derivedBattery.warning
  const hasBatteryConfig = boardKind === 'onewheel' || batteryWarning == null
  const canSave = Boolean(name.trim()) && hasBatteryConfig
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
    setBoardKind('vesc')
    setBleId(id)
    setBleName(deviceName)
    if (!name.trim()) setName(deviceName)
    setDraftLink(null)
    setPairPhase('probing')
  }

  const selectOneWheel = (id: string, deviceName: string) => {
    setBoardKind('onewheel')
    setBleId(id)
    setBleName(deviceName)
    if (!name.trim()) setName(deviceName || 'OneWheel')
    setDraftLink({ bleId: id, transport: 'direct' })
    setPairPhase('onewheel')
  }

  const onOneWheelReady = () => {
    setPairPhase('select')
    next()
  }

  // Drop the chosen peripheral and return to the device list.
  const clearDevice = () => {
    setBoardKind('vesc')
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

  const save = () => {
    if (!canSave) return
    const batteryConfig =
      boardKind === 'onewheel'
        ? null
        : buildBatteryConfig(
            batteryMode,
            cellPresetId,
            seriesCount,
            parallelCount,
            manualMinVoltage,
            manualMaxVoltage,
          )
    const board = addBoard({
      name: name.trim(),
      kind: boardKind,
      description: description.trim() || undefined,
      link: draftLink,
      batteryConfig,
      // Persist the draft alert setup onto the new Board (#254), then materialize its preset rules.
      topSpeedKmh,
      alertPreset: draftAlertPresetSelection(alertSetup),
      alertPresetsOnboarded: true,
    })
    setActiveBoard(board.id)
    void (async () => {
      await useAlertsStore.getState().load(board.id)
      // Flush the rider's own rules first: they carry no board id until one exists, and metrics
      // holding them are `custom`, so the regeneration below never touches them.
      for (const { rules } of Object.values(alertSetup)) {
        for (const rule of rules) {
          await useAlertsStore.getState().upsert({ ...rule, boardId: board.id })
        }
      }
      await useAlertPresetStore.getState().regenerateAll()
    })()
    router.dismissAll()
  }

  return {
    step,
    stepId: steps[step] ?? steps[steps.length - 1]!,
    steps,
    pairPhase,
    boardKind,
    bleId,
    bleName,
    draftLink,
    name,
    description,
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
    canSave,
    setStep,
    next,
    back,
    selectDevice,
    selectOneWheel,
    onOneWheelReady,
    clearDevice,
    onDeviceProbed,
    continueOffline,
    setName,
    setDescription,
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
