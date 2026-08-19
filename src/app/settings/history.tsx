import { StyleSheet, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  GaugeIcon,
  ArrowsOutLineHorizontalIcon,
  ProhibitIcon,
  ClockCounterClockwiseIcon,
  PathIcon,
} from 'phosphor-react-native'
import { useShallow } from 'zustand/react/shallow'

import { Text } from '@/components/base/Text'

import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import { useHistoryStore } from '@/modules/history/store/historyStore'
import { DEFAULT_RIDE_SPLIT_GAP_MINUTES } from '@/modules/history/lib/sessions'
import { theme } from '@/constants/theme'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { Stepper } from '@/components/forms/Stepper'
import { IconHero } from '@/components/settings/IconHero'

const MIN_RIDE_SPLIT_GAP_MINUTES = 1
const MAX_RIDE_SPLIT_GAP_MINUTES = 240

export default function HistorySettingsScreen() {
  const {
    rideSplitGapMinutes,
    movingSpeedThresholdKmh,
    freeSpinMaxSpeedDeltaKmh,
    freeSpinStationaryBoardCapKmh,
    set,
  } = useSettingsStore(
    useShallow((s) => ({
      rideSplitGapMinutes: s.rideSplitGapMinutes,
      movingSpeedThresholdKmh: s.movingSpeedThresholdKmh,
      freeSpinMaxSpeedDeltaKmh: s.freeSpinMaxSpeedDeltaKmh,
      freeSpinStationaryBoardCapKmh: s.freeSpinStationaryBoardCapKmh,
      set: s.set,
    })),
  )
  const regroupSessions = useHistoryStore((s) => s.regroupSessions)

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={ClockCounterClockwiseIcon}
          description="How recorded telemetry becomes rides in your history."
        />

        <SettingsCard>
          <SettingsRow
            icon={PathIcon}
            label="Split rides after"
            hint={`A stop longer than this starts a new ride. Applies to past rides too.\nDefault: ${DEFAULT_RIDE_SPLIT_GAP_MINUTES} min.`}
            right={
              <Stepper
                value={rideSplitGapMinutes}
                unit="min"
                min={MIN_RIDE_SPLIT_GAP_MINUTES}
                max={MAX_RIDE_SPLIT_GAP_MINUTES}
                onChange={(nextValue) => {
                  const clampedValue = Math.min(
                    MAX_RIDE_SPLIT_GAP_MINUTES,
                    Math.max(MIN_RIDE_SPLIT_GAP_MINUTES, nextValue),
                  )
                  if (clampedValue === rideSplitGapMinutes) return
                  void set('rideSplitGapMinutes', clampedValue).then(regroupSessions)
                }}
              />
            }
          />
        </SettingsCard>

        <SettingsSectionTitle>Filters</SettingsSectionTitle>
        <Text style={styles.sectionHint}>
          Changes apply to new rides only. Rebuild history to reprocess past rides.
        </Text>

        <SettingsCard>
          <SettingsRow
            icon={GaugeIcon}
            label="Moving speed threshold"
            hint={'Speeds below this are ignored for avg speed.\nDefault: 3 km/h.'}
            right={
              <Stepper
                value={movingSpeedThresholdKmh}
                unit="km/h"
                min={0}
                max={20}
                onChange={(nextValue) => {
                  const clampedValue = Math.min(20, Math.max(0, nextValue))
                  if (clampedValue !== movingSpeedThresholdKmh) {
                    void set('movingSpeedThresholdKmh', clampedValue)
                  }
                }}
              />
            }
          />
          <SettingsRow
            icon={ArrowsOutLineHorizontalIcon}
            label="Free spin speed delta"
            hint={
              'Max board-vs-GPS speed gap before sample is excluded as free spin. Lower will increase the number of excluded samples.\nDefault: 12 km/h.'
            }
            right={
              <Stepper
                value={freeSpinMaxSpeedDeltaKmh}
                unit="km/h"
                min={1}
                max={60}
                onChange={(nextValue) => {
                  const clampedValue = Math.min(60, Math.max(1, nextValue))
                  if (clampedValue !== freeSpinMaxSpeedDeltaKmh) {
                    void set('freeSpinMaxSpeedDeltaKmh', clampedValue)
                  }
                }}
              />
            }
          />
          <SettingsRow
            icon={ProhibitIcon}
            label="Free spin stationary cap"
            hint={
              'Max board speed allowed when GPS is nearly stationary. Lower will increase the number of excluded samples.\nDefault: 15 km/h.'
            }
            right={
              <Stepper
                value={freeSpinStationaryBoardCapKmh}
                unit="km/h"
                min={1}
                max={60}
                onChange={(nextValue) => {
                  const clampedValue = Math.min(60, Math.max(1, nextValue))
                  if (clampedValue !== freeSpinStationaryBoardCapKmh) {
                    void set('freeSpinStationaryBoardCapKmh', clampedValue)
                  }
                }}
              />
            }
          />
        </SettingsCard>
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
  sectionHint: {
    color: theme.neutral.textDim,
    fontSize: 12,
    marginTop: -4,
    marginBottom: 4,
    marginLeft: 4,
  },
})
