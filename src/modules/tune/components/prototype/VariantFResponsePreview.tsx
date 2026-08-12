import { memo, useEffect, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import {
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import type { TuneProfileFieldValue } from 'vescape-core'
import { HandPalmIcon, LightningIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { MonoValue } from '@/components/base/MonoValue'
import { InfoModal } from '@/components/modals/InfoModal'
import { theme } from '@/constants/theme'
import { TunePreview } from '@/modules/tune/components/TunePreview'
import { responseLeanAngleDegrees } from '@/modules/tune/lib/tunePreviewGeometry'

export type ResponseScenario = 'acceleration' | 'braking'

const RESPONSE_SPEED_KMH = 15

export const VariantFResponsePreview = memo(function VariantFResponsePreview({
  fields,
  scenario,
  aggressiveness,
  stiffness,
  cycling = false,
  onScenarioChange,
}: {
  fields: Record<string, TuneProfileFieldValue>
  scenario: ResponseScenario
  aggressiveness: number
  stiffness: number
  cycling?: boolean
  onScenarioChange: (scenario: ResponseScenario) => void
}) {
  const [helpVisible, setHelpVisible] = useState(false)
  const pitchInputDegrees = useSharedValue(0)
  const pitchInputActive = useSharedValue(false)
  const speedKmh = useSharedValue(cycling ? 5 : RESPONSE_SPEED_KMH)
  const riderLeanAngleDegrees = useSharedValue(0)
  const speedText = useDerivedValue(() => `${speedKmh.value.toFixed(1)} km/h`)

  useEffect(() => {
    const magnitude = responseLeanAngleDegrees(aggressiveness, stiffness)
    riderLeanAngleDegrees.value = withTiming(scenario === 'acceleration' ? -magnitude : magnitude, {
      duration: 350,
    })
  }, [aggressiveness, riderLeanAngleDegrees, scenario, stiffness])

  useAnimatedReaction(
    () => speedKmh.value,
    (speed) => {
      if (!cycling) return
      if (scenario === 'acceleration' && speed >= 30) {
        scheduleOnRN(onScenarioChange, 'braking')
      } else if (scenario === 'braking' && speed <= 5) {
        scheduleOnRN(onScenarioChange, 'acceleration')
      }
    },
    [cycling, onScenarioChange, scenario, speedKmh],
  )

  return (
    <View style={styles.root}>
      <View style={styles.preview}>
        <TunePreview
          fields={fields}
          pitchInputDegrees={pitchInputDegrees}
          pitchInputActive={pitchInputActive}
          hillsEnabled={false}
          speedKmh={speedKmh}
          riderLeanAngleDegrees={riderLeanAngleDegrees}
          riderLoadCurrentAmps={
            scenario === 'acceleration' ? (cycling ? 35 : 25) : cycling ? -60 : -25
          }
          initialSpeedKmh={cycling ? 5 : RESPONSE_SPEED_KMH}
          minimumSpeedKmh={cycling ? 5 : undefined}
          maximumSpeedKmh={cycling ? 30 : undefined}
          lockedSpeedKmh={cycling ? undefined : RESPONSE_SPEED_KMH}
          active
          minimal
          showMinimalHelp={cycling}
          onHelp={() => setHelpVisible(true)}
        />
      </View>
      {cycling ? (
        <View style={styles.speedReadout}>
          <MonoValue
            text={speedText}
            size={17}
            weight="700"
            color={theme.telemetry.speed}
            align="center"
            width={250}
          />
        </View>
      ) : (
        <View style={styles.tabs}>
          {(['acceleration', 'braking'] as const).map((item) => {
            const active = scenario === item
            const Icon = item === 'acceleration' ? LightningIcon : HandPalmIcon
            const color =
              item === 'acceleration' ? theme.palette.sky.color : theme.palette.orange.color
            return (
              <Pressable
                key={item}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={[
                  styles.tab,
                  active &&
                    (item === 'acceleration'
                      ? styles.accelerationTabActive
                      : styles.brakingTabActive),
                ]}
                onPress={() => onScenarioChange(item)}
              >
                <Icon
                  size={14}
                  color={active ? color : theme.palette.slate.textMuted}
                  weight={active ? 'fill' : 'duotone'}
                />
                <Text style={[styles.tabText, active && { color }]}>
                  {item === 'acceleration' ? 'Acceleration' : 'Braking'}
                </Text>
              </Pressable>
            )
          })}
        </View>
      )}
      <InfoModal
        visible={helpVisible}
        variant="warning"
        title={cycling ? 'Ride style preview' : 'Response preview'}
        message={
          cycling
            ? 'The Board accelerates from 5 to 30 km/h, then brakes back to 5 km/h on flat ground. Current, Torque Tilt, Brake Tilt, ATR and Target remain model outputs.'
            : 'Response compares a controlled rider lean at a locked 15 km/h on flat ground. Aggressiveness changes deck lean, while Nose and Tail stiffness change support and Target.'
        }
        onDismiss={() => setHelpVisible(false)}
      />
    </View>
  )
})

const styles = StyleSheet.create({
  root: { marginHorizontal: -16 },
  preview: { position: 'relative' },
  tabs: {
    alignSelf: 'center',
    width: 250,
    flexDirection: 'row',
    padding: 3,
    borderRadius: 12,
    backgroundColor: theme.palette.slate.surfaceDeep,
    marginTop: -12,
  },
  speedReadout: {
    alignSelf: 'center',
    width: 250,
    minHeight: 38,
    justifyContent: 'center',
    marginTop: -12,
  },
  tab: {
    flex: 1,
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 9,
  },
  accelerationTabActive: { backgroundColor: theme.palette.sky.bg },
  brakingTabActive: { backgroundColor: theme.palette.orange.bg },
  tabText: { color: theme.palette.slate.textMuted, fontSize: 10, fontWeight: '800' },
})
