import { useCallback, useEffect, useRef, useState } from 'react'
import type { BatteryConfig } from 'vescape-core'

import {
  type BatteryMode,
  buildBatteryConfig,
  getBatterySummary,
  parseVoltage,
} from '@/modules/board/lib/boardSetup'
import { DEFAULT_BATTERY_CONFIG, deriveBatteryConfig } from '@/modules/battery/lib'
import type { Board } from '@/modules/board/store/boardStore'
import {
  RAIL_COLORS,
  RAILS,
  type RailColorId,
  type RailId,
} from '@/modules/board/components/add-board-wizard/BoardPersonalizer'

type SaveKind = 'info' | 'battery' | 'link'

export interface BoardInfoDraft {
  name: string
  railId: RailId
  railColorId: RailColorId
}

export interface BoardBatteryDraft {
  batteryMode: BatteryMode
  cellPresetId: string
  seriesCount: number
  parallelCount: number
  manualMinVoltage: string
  manualMaxVoltage: string
}

export function useEditBoardForm({
  board,
  updateBoard,
}: {
  board: Board | undefined
  updateBoard: (board: Board) => Promise<void>
}) {
  const boardRef = useRef<Board | undefined>(board)
  const syncedBoardIdRef = useRef<string | null>(null)
  const [name, setName] = useState(board?.name ?? '')
  const [railId, setRailId] = useState<RailId>(() => railIdFromBoard(board))
  const [railColorId, setRailColorId] = useState<RailColorId>(() => railColorIdFromBoard(board))
  const [battery, setBattery] = useState(() => batteryDraftFromConfig(board?.batteryConfig))
  const [batteryTouched, setBatteryTouched] = useState(false)
  const [saving, setSaving] = useState<SaveKind | null>(null)

  useEffect(() => {
    boardRef.current = board
    if (!board || syncedBoardIdRef.current === board.id) return

    setName(board.name)
    setRailId(railIdFromBoard(board))
    setRailColorId(railColorIdFromBoard(board))
    setBattery(batteryDraftFromConfig(board.batteryConfig))
    setBatteryTouched(false)
    syncedBoardIdRef.current = board.id
  }, [board])

  const saveBoard = useCallback(
    async (
      patch: Partial<Pick<Board, 'name' | 'personalization' | 'batteryConfig' | 'link'>>,
      kind: SaveKind,
    ) => {
      const current = boardRef.current
      if (!current) return
      const next = { ...current, ...patch }
      boardRef.current = next
      setSaving(kind)
      try {
        await updateBoard(next)
      } finally {
        setSaving(null)
      }
    },
    [updateBoard],
  )

  const previewConfig: BatteryConfig =
    battery.batteryMode === 'preset'
      ? {
          mode: 'preset',
          cellPresetId: battery.cellPresetId,
          seriesCount: battery.seriesCount,
          parallelCount: battery.parallelCount,
        }
      : {
          mode: 'manual',
          minVoltage: parseVoltage(battery.manualMinVoltage) ?? 0,
          maxVoltage: parseVoltage(battery.manualMaxVoltage) ?? 0,
        }
  const derivedBattery = deriveBatteryConfig(previewConfig)
  const keepMissingBatteryConfig = Boolean(board && board.batteryConfig == null && !batteryTouched)
  const batterySummary = getBatterySummary(
    keepMissingBatteryConfig,
    derivedBattery,
    battery.batteryMode,
    battery.cellPresetId,
    battery.seriesCount,
    battery.parallelCount,
  )

  const saveInfo = useCallback(
    async (value: BoardInfoDraft) => {
      setName(value.name)
      setRailId(value.railId)
      setRailColorId(value.railColorId)
      await saveBoard(
        {
          name: value.name.trim(),
          personalization: { railId: value.railId, railColorId: value.railColorId },
        },
        'info',
      )
    },
    [saveBoard],
  )

  const saveBattery = useCallback(
    async (value: BoardBatteryDraft) => {
      const batteryConfig = buildBatteryConfig(
        value.batteryMode,
        value.cellPresetId,
        value.seriesCount,
        value.parallelCount,
        value.manualMinVoltage,
        value.manualMaxVoltage,
      )
      if (!batteryConfig) return false

      setBattery(value)
      setBatteryTouched(true)
      await saveBoard({ batteryConfig }, 'battery')
      return true
    },
    [saveBoard],
  )

  // Unlinking clears the whole Board Link (BLE id + transport) at once.
  const unlink = useCallback(async () => {
    await saveBoard({ link: null }, 'link')
  }, [saveBoard])

  return {
    name,
    railId,
    railColorId,
    battery,
    batterySummary,
    keepMissingBatteryConfig,
    saving,
    saveInfo,
    saveBattery,
    unlink,
  }
}

function railIdFromBoard(board: Board | undefined): RailId {
  const stored = board?.personalization?.railId
  return RAILS.some((rail) => rail.id === stored) ? (stored as RailId) : 'xr'
}

function railColorIdFromBoard(board: Board | undefined): RailColorId {
  const stored = board?.personalization?.railColorId
  return RAIL_COLORS.some((color) => color.id === stored) ? (stored as RailColorId) : 'cyan'
}

function batteryDraftFromConfig(config: BatteryConfig | null | undefined): BoardBatteryDraft {
  const batteryConfig = config ?? DEFAULT_BATTERY_CONFIG
  const preset = batteryConfig.mode === 'preset' ? batteryConfig : DEFAULT_BATTERY_CONFIG
  const manual =
    batteryConfig.mode === 'manual'
      ? batteryConfig
      : { mode: 'manual' as const, minVoltage: 60, maxVoltage: 84 }

  return {
    batteryMode: batteryConfig.mode,
    cellPresetId: preset.cellPresetId,
    seriesCount: preset.seriesCount,
    parallelCount: preset.parallelCount,
    manualMinVoltage: String(manual.minVoltage),
    manualMaxVoltage: String(manual.maxVoltage),
  }
}
