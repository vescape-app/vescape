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
import {
  useMotorConfigFields,
  useMotorConfigValuesStore,
} from '@/modules/board/store/motorConfigValuesStore'

/**
 * Raw dump of the requested Board's decoded Refloat and motor config. Current session values take
 * priority over the durable Last Known copy; metadata identifies each config's freshness.
 */
export default function BoardConfigScreen() {
  const { boardId } = useLocalSearchParams<{ boardId: string }>()
  const values = useBoardConfigFields(boardId)
  const configError = useBoardConfigValuesStore((s) => s.error)
  const motor = useMotorConfigFields(boardId)
  const motorError = useMotorConfigValuesStore((s) => s.error)

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

  const motorMeta = useMemo(
    () =>
      motor
        ? {
            boardId: motor.boardId,
            signature: motor.signature,
            firmware: motor.firmware,
            freshness: motor.freshness,
            capturedAt: new Date(motor.capturedAtMs).toISOString(),
            fieldCount: Object.keys(motor.values).length,
          }
        : null,
    [motor],
  )

  /**
   * 196 fields arrive in map order, which is meaningless to read. Sorting by id groups the firmware's
   * own prefixes together — `bms.*`, `foc_*`, `l_*`, `m_*`, `si_*` — so related settings sit adjacent.
   */
  const motorValues = useMemo(() => {
    if (!motor) return null
    return Object.fromEntries(Object.entries(motor.values).sort(([a], [b]) => a.localeCompare(b)))
  }, [motor])

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <PageScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={BracketsCurlyIcon}
          description="Decoded Refloat and VESC motor config for this board, from the current session or its last saved read."
        />
        {configError ? <Text style={styles.error}>{configError}</Text> : null}
        {motorError ? <Text style={styles.error}>{motorError}</Text> : null}

        <RawSection
          title="Config read"
          data={meta}
          exportName="board-config-meta"
          empty="No saved config — connect this board to read it"
        />

        <RawSection
          title="Refloat config"
          data={values ? values.values : null}
          exportName="refloat-config"
          empty="No saved config — connect this board to read it"
        />

        <RawSection
          title="Motor config read"
          data={motorMeta}
          exportName="motor-config-meta"
          empty="No saved motor config — connect this board to read it"
        />

        <RawSection
          title="Motor config (MCCONF)"
          data={motorValues}
          exportName="motor-config"
          empty="No saved motor config — connect this board to read it"
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
