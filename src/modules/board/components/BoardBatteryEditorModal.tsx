import { useState } from 'react'
import { Modal, Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import type { BatteryConfig } from 'vescape-core'

import { BoardBatteryForm } from '@/modules/board/components/BoardBatteryForm'
import { Button } from '@/components/base/Button'
import { buildBatteryConfig } from '@/modules/board/lib/boardSetup'
import { theme } from '@/constants/theme'

type BatteryMode = BatteryConfig['mode']

interface BoardBatteryEditorModalProps {
  visible: boolean
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={handleCancel} disabled={saving} />
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
      </View>
    </Modal>
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
}: Omit<BoardBatteryEditorModalProps, 'visible' | 'onCancel'>) {
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
    <View style={styles.card}>
      <Text style={styles.title}>Battery</Text>
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
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: theme.alpha(theme.palette.mono.black, 0.6),
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: theme.neutral.surfaceDeep,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    padding: 20,
    gap: 12,
  },
  title: {
    color: theme.neutral.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
})
