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

type SaveKind = 'info' | 'battery' | 'link'

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
  const [battery, setBattery] = useState(() => batteryDraftFromConfig(board?.batteryConfig))
  const [batteryTouched, setBatteryTouched] = useState(false)
  const [saving, setSaving] = useState<SaveKind | null>(null)

  useEffect(() => {
    boardRef.current = board
    if (!board || syncedBoardIdRef.current === board.id) return

    setName(board.name)
    setBattery(batteryDraftFromConfig(board.batteryConfig))
    setBatteryTouched(false)
    syncedBoardIdRef.current = board.id
  }, [board])

  const saveBoard = useCallback(
    async (patch: Partial<Pick<Board, 'name' | 'batteryConfig' | 'link'>>, kind: SaveKind) => {
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

  const saveName = useCallback(
    async (value: string) => {
      setName(value)
      await saveBoard({ name: value.trim() }, 'info')
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
    battery,
    batterySummary,
    keepMissingBatteryConfig,
    saving,
    saveName,
    saveBattery,
    unlink,
  }
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
