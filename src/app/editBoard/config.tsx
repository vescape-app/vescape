import { useMemo } from 'react'
import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import { BracketsCurlyIcon } from 'phosphor-react-native'

import { IconHero } from '@/components/settings/IconHero'
import { RawSection } from '@/components/settings/RawSection'
import { theme } from '@/constants/theme'
import { useBoardConfigValuesStore } from '@/modules/board/store/boardConfigValuesStore'
import { useMotorConfigValuesStore } from '@/modules/board/store/motorConfigValuesStore'

/**
 * Raw dump of this Board Session's decoded Refloat config. Values are session-scoped (ADR 0035), so
 * the dump is empty unless the board being edited is the connected one.
 */
export default function BoardConfigScreen() {
  const { boardId } = useLocalSearchParams<{ boardId: string }>()
  const values = useBoardConfigValuesStore((s) => s.values)
  const forThisBoard = values && (values.boardId == null || values.boardId === boardId)
  const motor = useMotorConfigValuesStore((s) => s.values)
  const motorForThisBoard = motor && (motor.boardId == null || motor.boardId === boardId)

  const meta = useMemo(
    () =>
      forThisBoard && values
        ? {
            boardId: values.boardId,
            refloatBaseVersion: values.refloatBaseVersion,
            freshness: values.freshness,
            capturedAt: new Date(values.capturedAtMs).toISOString(),
            fieldCount: Object.keys(values.values).length,
          }
        : null,
    [forThisBoard, values],
  )

  const motorMeta = useMemo(
    () =>
      motorForThisBoard && motor
        ? {
            boardId: motor.boardId,
            signature: motor.signature,
            firmware: motor.firmware,
            freshness: motor.freshness,
            capturedAt: new Date(motor.capturedAtMs).toISOString(),
            fieldCount: Object.keys(motor.values).length,
          }
        : null,
    [motorForThisBoard, motor],
  )

  /**
   * 196 fields arrive in map order, which is meaningless to read. Sorting by id groups the firmware's
   * own prefixes together — `bms.*`, `foc_*`, `l_*`, `m_*`, `si_*` — so related settings sit adjacent.
   */
  const motorValues = useMemo(() => {
    if (!motorForThisBoard || !motor) return null
    return Object.fromEntries(Object.entries(motor.values).sort(([a], [b]) => a.localeCompare(b)))
  }, [motorForThisBoard, motor])

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={BracketsCurlyIcon}
          description="Decoded Refloat and VESC motor config for the current Board Session, exactly as read."
        />

        <RawSection
          title="Config read"
          data={meta}
          exportName="board-config-meta"
          empty="No config read — connect this board"
        />

        <RawSection
          title="Refloat config"
          data={forThisBoard && values ? values.values : null}
          exportName="refloat-config"
          empty="No config read — connect this board"
        />

        <RawSection
          title="Motor config read"
          data={motorMeta}
          exportName="motor-config-meta"
          empty="No motor config read — connect this board"
        />

        <RawSection
          title="Motor config (MCCONF)"
          data={motorValues}
          exportName="motor-config"
          empty="No motor config read — connect this board"
        />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.palette.slate.bg,
  },
  content: {
    padding: 16,
    gap: 8,
  },
})
