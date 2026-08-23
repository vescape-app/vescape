import { useMemo } from 'react'
import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import { BracketsCurlyIcon } from 'phosphor-react-native'

import { IconHero } from '@/components/settings/IconHero'
import { RawSection } from '@/components/settings/RawSection'
import { theme } from '@/constants/theme'
import { useBoardConfigValuesStore } from '@/modules/board/store/boardConfigValuesStore'

/**
 * Raw dump of this Board Session's decoded Refloat config. Values are session-scoped (ADR 0035), so
 * the dump is empty unless the board being edited is the connected one.
 */
export default function BoardConfigScreen() {
  const { boardId } = useLocalSearchParams<{ boardId: string }>()
  const values = useBoardConfigValuesStore((s) => s.values)
  const forThisBoard = values && (values.boardId == null || values.boardId === boardId)

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

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={BracketsCurlyIcon}
          description="Decoded Refloat config for the current Board Session, exactly as read."
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
