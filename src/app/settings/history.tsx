import { useFormat } from '@/hooks/useFormat'
import { useDistanceUnit } from '@/hooks/useDistanceUnit'
import { speedFromKmh, speedInputToKmh, speedUnit } from '@/helpers/units'
import { stepDelta } from '@/helpers/numberStep'
import { StyleSheet, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  GaugeIcon,
  ArrowsOutLineHorizontalIcon,
  ProhibitIcon,
  ClockCounterClockwiseIcon,
  PathIcon,
  WaveformIcon,
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
  const distanceUnit = useDistanceUnit()
  const { formatSpeedWithUnit } = useFormat()
  const {
    rideSplitGapMinutes,
    movingSpeedThresholdKmh,
    freeSpinMaxSpeedDeltaKmh,
    freeSpinStationaryBoardCapKmh,
    socEstimateWindowSeconds,
    set,
  } = useSettingsStore(
    useShallow((s) => ({
      rideSplitGapMinutes: s.rideSplitGapMinutes,
      movingSpeedThresholdKmh: s.movingSpeedThresholdKmh,
      freeSpinMaxSpeedDeltaKmh: s.freeSpinMaxSpeedDeltaKmh,
      freeSpinStationaryBoardCapKmh: s.freeSpinStationaryBoardCapKmh,
      socEstimateWindowSeconds: s.socEstimateWindowSeconds,
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
            hint={`A stop longer than this starts a new ride. Disconnects and app restarts in between do not.\nDefault: ${DEFAULT_RIDE_SPLIT_GAP_MINUTES} min.`}
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
          Changing this updates all past rides in the background. It can take a while, and until it
          finishes some rides still show values from the old setting.
        </Text>

        <SettingsCard>
          <SettingsRow
            icon={GaugeIcon}
            label="Moving speed threshold"
            hint={`Speeds below this are ignored for avg speed.\nDefault: ${formatSpeedWithUnit(3, distanceUnit === 'mi' ? 1 : 0)}.`}
            right={
              <Stepper
                value={speedFromKmh(movingSpeedThresholdKmh, distanceUnit)}
                formatValue={(value) => String(Number(value.toFixed(1)))}
                step={stepDelta}
                unit={speedUnit(distanceUnit)}
                min={speedFromKmh(0, distanceUnit)}
                max={speedFromKmh(20, distanceUnit)}
                onChange={(nextValue) => {
                  const clampedValue = speedInputToKmh(
                    nextValue,
                    movingSpeedThresholdKmh,
                    distanceUnit,
                    0,
                    20,
                  )
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
            hint={`Max board-vs-GPS speed gap before sample is excluded as free spin. Lower will increase the number of excluded samples.\nDefault: ${formatSpeedWithUnit(12, distanceUnit === 'mi' ? 1 : 0)}.`}
            right={
              <Stepper
                value={speedFromKmh(freeSpinMaxSpeedDeltaKmh, distanceUnit)}
                formatValue={(value) => String(Number(value.toFixed(1)))}
                step={stepDelta}
                unit={speedUnit(distanceUnit)}
                min={speedFromKmh(1, distanceUnit)}
                max={speedFromKmh(60, distanceUnit)}
                onChange={(nextValue) => {
                  const clampedValue = speedInputToKmh(
                    nextValue,
                    freeSpinMaxSpeedDeltaKmh,
                    distanceUnit,
                    1,
                    60,
                  )
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
            hint={`Max board speed allowed when GPS is nearly stationary. Lower will increase the number of excluded samples.\nDefault: ${formatSpeedWithUnit(15, distanceUnit === 'mi' ? 1 : 0)}.`}
            right={
              <Stepper
                value={speedFromKmh(freeSpinStationaryBoardCapKmh, distanceUnit)}
                formatValue={(value) => String(Number(value.toFixed(1)))}
                step={stepDelta}
                unit={speedUnit(distanceUnit)}
                min={speedFromKmh(1, distanceUnit)}
                max={speedFromKmh(60, distanceUnit)}
                onChange={(nextValue) => {
                  const clampedValue = speedInputToKmh(
                    nextValue,
                    freeSpinStationaryBoardCapKmh,
                    distanceUnit,
                    1,
                    60,
                  )
                  if (clampedValue !== freeSpinStationaryBoardCapKmh) {
                    void set('freeSpinStationaryBoardCapKmh', clampedValue)
                  }
                }}
              />
            }
          />
          <SettingsRow
            icon={WaveformIcon}
            label="Battery smoothing"
            hint="Median window steadies battery % for display and alerts. 0 = off"
            right={
              <Stepper
                value={socEstimateWindowSeconds}
                unit="s"
                min={0}
                max={120}
                step={5}
                onChange={(nextValue) => {
                  const clampedValue = Math.min(120, Math.max(0, nextValue))
                  if (clampedValue !== socEstimateWindowSeconds) {
                    void set('socEstimateWindowSeconds', clampedValue)
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
