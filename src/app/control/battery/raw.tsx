import { useMemo } from 'react'
import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { BatteryChargingIcon } from 'phosphor-react-native'

import { IconHero } from '@/components/settings/IconHero'
import { RawSection } from '@/components/settings/RawSection'
import { summarizeBms } from '@/modules/battery/lib'
import { useBleStore } from '@/modules/board/store/bleStore'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { theme } from '@/constants/theme'

export default function BatteryRawScreen() {
  // Latest smart-BMS snapshot; the store swaps the whole object each poll, so this
  // re-renders live as native emits `onBms`.
  const bms = useBleStore((s) => s.latestBms)
  const bmsLinked = useBoardStore(
    (s) => s.boards.find((b) => b.id === s.activeBoardId)?.link?.hasBms === true,
  )

  // Pack-level min/max/spread derived from the raw cell groups, minus the per-group
  // rows (those already appear verbatim in the raw snapshot above).
  const derived = useMemo(() => {
    const summary = summarizeBms(bms)
    if (!summary) return null
    const { groups: _groups, ...rest } = summary
    return rest
  }, [bms])

  const description = bmsLinked
    ? 'Live raw smart-BMS telemetry, exactly as parsed from the board.'
    : 'No smart-BMS detected. Re-link a board with a BMS over CAN to see live data.'

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero icon={BatteryChargingIcon} description={description} />

        <RawSection
          title="BMS snapshot"
          data={bms}
          exportName="bms-snapshot"
          empty={bmsLinked ? 'No smart-BMS data yet.' : 'No smart-BMS detected.'}
        />

        <RawSection
          title="Derived summary"
          data={derived}
          exportName="bms-summary"
          empty="No usable cell voltages yet."
        />
      </ScrollView>
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
})
