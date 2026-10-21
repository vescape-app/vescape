import { useState, type RefObject } from 'react'
import { StyleSheet, View } from 'react-native'
import type { BatteryConfig } from 'vescape-core'
import { BatteryChargingIcon } from 'phosphor-react-native'

import { BoardBatteryForm } from '@/modules/board/components/BoardBatteryForm'
import { Button } from '@/components/base/Button'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { buildBatteryConfig } from '@/modules/board/lib/boardSetup'
import { theme } from '@/constants/theme'

type BatteryMode = BatteryConfig['mode']

interface BoardBatteryEditorModalProps {
  visible: boolean
  triggerRef: RefObject<View | null>
  batteryMode: BatteryMode
  cellPresetId: string
  seriesCount: number
  parallelCount: number
  manualMinVoltage: string
  manualMaxVoltage: string
  saving?: boolean
  onSave: (value: {
    batteryMode: BatteryMode
    cellPresetId: string
    seriesCount: number
    parallelCount: number
    manualMinVoltage: string
    manualMaxVoltage: string
  }) => Promise<void> | void
  onCancel: () => void
}

export function BoardBatteryEditorModal({
  visible,
  triggerRef,
  batteryMode,
  cellPresetId,
  seriesCount,
  parallelCount,
  manualMinVoltage,
  manualMaxVoltage,
  saving = false,
  onSave,
  onCancel,
}: BoardBatteryEditorModalProps) {
  const handleCancel = () => {
    if (!saving) onCancel()
  }

  return (
    <EdgeDrawer
      visible={visible}
      triggerRef={triggerRef}
      onClose={handleCancel}
      title="Battery"
      icon={BatteryChargingIcon}
      iconColor={theme.settingsIcon.battery}
    >
      {visible ? (
        <BoardBatteryEditorModalContent
          batteryMode={batteryMode}
          cellPresetId={cellPresetId}
          seriesCount={seriesCount}
          parallelCount={parallelCount}
          manualMinVoltage={manualMinVoltage}
          manualMaxVoltage={manualMaxVoltage}
          saving={saving}
          onSave={onSave}
        />
      ) : null}
    </EdgeDrawer>
  )
}

function BoardBatteryEditorModalContent({
  batteryMode,
  cellPresetId,
  seriesCount,
  parallelCount,
  manualMinVoltage,
  manualMaxVoltage,
  saving = false,
  onSave,
}: Omit<BoardBatteryEditorModalProps, 'visible' | 'triggerRef' | 'onCancel'>) {
  const [draftBatteryMode, setDraftBatteryMode] = useState(batteryMode)
  const [draftCellPresetId, setDraftCellPresetId] = useState(cellPresetId)
  const [draftSeriesCount, setDraftSeriesCount] = useState(seriesCount)
  const [draftParallelCount, setDraftParallelCount] = useState(parallelCount)
  const [draftManualMinVoltage, setDraftManualMinVoltage] = useState(manualMinVoltage)
  const [draftManualMaxVoltage, setDraftManualMaxVoltage] = useState(manualMaxVoltage)

  const canSave =
    buildBatteryConfig(
      draftBatteryMode,
      draftCellPresetId,
      draftSeriesCount,
      draftParallelCount,
      draftManualMinVoltage,
      draftManualMaxVoltage,
    ) !== null

  return (
    <View style={styles.content}>
      <BoardBatteryForm
        batteryMode={draftBatteryMode}
        cellPresetId={draftCellPresetId}
        seriesCount={draftSeriesCount}
        parallelCount={draftParallelCount}
        manualMinVoltage={draftManualMinVoltage}
        manualMaxVoltage={draftManualMaxVoltage}
        onChangeBatteryMode={setDraftBatteryMode}
        onChangeCellPresetId={setDraftCellPresetId}
        onChangeSeriesCount={setDraftSeriesCount}
        onChangeParallelCount={setDraftParallelCount}
        onChangeManualMinVoltage={setDraftManualMinVoltage}
        onChangeManualMaxVoltage={setDraftManualMaxVoltage}
        testIDPrefix="edit-board-battery"
      />
      <Button
        label="Save"
        loading={saving}
        disabled={!canSave}
        onPress={() =>
          onSave({
            batteryMode: draftBatteryMode,
            cellPresetId: draftCellPresetId,
            seriesCount: draftSeriesCount,
            parallelCount: draftParallelCount,
            manualMinVoltage: draftManualMinVoltage,
            manualMaxVoltage: draftManualMaxVoltage,
          })
        }
        testID="edit-board-battery-save"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 24, gap: 20 },
})
