import { PageScrollView } from '@/components/base/PageScrollView'
import { useMemo } from 'react'
import { StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import { BracketsCurlyIcon } from 'phosphor-react-native'

import { IconHero } from '@/components/settings/IconHero'
import { RawSection } from '@/components/settings/RawSection'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import {
  useBoardConfigFields,
  useBoardConfigValuesStore,
} from '@/modules/board/store/boardConfigValuesStore'

export default function BoardConfigReadScreen() {
  const { boardId } = useLocalSearchParams<{ boardId: string }>()
  const values = useBoardConfigFields(boardId)
  const configError = useBoardConfigValuesStore((s) => s.error)

  const meta = useMemo(
    () =>
      values
        ? {
            boardId: values.boardId,
            refloatBaseVersion: values.refloatBaseVersion,
            freshness: values.freshness,
            capturedAt: new Date(values.capturedAtMs).toISOString(),
            fieldCount: Object.keys(values.values).length,
          }
        : null,
    [values],
  )

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <PageScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={BracketsCurlyIcon}
          description="Details of the current or last saved Refloat configuration read for this board."
        />
        {configError ? <Text style={styles.error}>{configError}</Text> : null}

        <RawSection
          title="Config read"
          data={meta}
          exportName="board-config-meta"
          empty="No saved config — connect this board to read it"
        />
      </PageScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.neutral.bg,
  },
  content: {
    padding: 16,
    gap: 8,
  },
  error: {
    color: theme.status.error.text,
    fontSize: 12,
  },
})
