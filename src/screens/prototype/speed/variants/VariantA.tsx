/** PROTOTYPE — Variant A: "Speed tape". Aviation instrument: the scale slides under a fixed
 * needle and the alert band is painted into the tape, so you watch the warning zone approach.
 * Alerts live in a yellow-bordered block — the one loud frame on the screen. */
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BellRingingIcon, PencilSimpleIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { IconButton } from '@/components/base/IconButton'
import { theme } from '@/constants/theme'
import { MetricDetailChart } from '@/modules/board/components/MetricDetailChart'

import {
  BigReadout,
  HeroBack,
  LEVELS,
  SPEED,
  SpeedTape,
  TestButton,
  describeSpec,
  useDisplayValue,
  useSpeedAlertModel,
  type VariantProps,
} from '../kit'

export function VariantA({ controller, live, points, windowMs, excludedRanges }: VariantProps) {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const model = useSpeedAlertModel(controller)
  const value = useDisplayValue(live, model.alertTest)

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 4 }]}
    >
      <View style={styles.head}>
        <HeroBack />
        <View style={styles.flex} />
        <Text style={styles.headMeta}>SPEED</Text>
      </View>

      <View style={styles.instrument}>
        <View style={styles.readout}>
          <BigReadout value={value} size={92} width={190} />
          <Text style={styles.unit}>{SPEED.unit}</Text>
        </View>
        <SpeedTape
          value={value}
          max={model.max}
          markers={model.markers}
          width={width - 32}
          height={86}
        />
      </View>

      <View style={styles.alertsBlock}>
        <View style={styles.alertsHead}>
          <BellRingingIcon size={18} color={theme.palette.yellow.color} weight="duotone" />
          <Text style={styles.alertsTitle}>Alerts</Text>
          <View style={styles.flex} />
          <TestButton alertTest={model.alertTest} />
          <IconButton
            icon={PencilSimpleIcon}
            size="sm"
            accessibilityLabel="Edit alerts"
            onPress={() => controller?.customize()}
          />
        </View>

        <View style={styles.levelRow}>
          {LEVELS.map((level) => {
            const on = level.id === model.level
            return (
              <Pressable
                key={level.id}
                onPress={() => controller?.setLevel(level.id)}
                style={[
                  styles.level,
                  on && { borderColor: level.tone.color, backgroundColor: level.tone.bg },
                ]}
              >
                <Text
                  style={[
                    styles.levelLabel,
                    { color: on ? level.tone.color : theme.palette.slate.textMuted },
                  ]}
                >
                  {level.label}
                </Text>
              </Pressable>
            )
          })}
        </View>

        <Text style={styles.alertsNote}>
          {model.specs.length === 0
            ? 'Nothing announced for speed.'
            : model.specs
                .map((spec) => {
                  const d = describeSpec(spec, model.max)
                  return `Band ${d.range} — beeps ${d.cadence}.`
                })
                .join(' ')}
        </Text>
      </View>

      <View style={styles.chart}>
        <MetricDetailChart
          metric={SPEED}
          points={points}
          range={{ y: SPEED.chartRange }}
          windowMs={windowMs}
          excludedRanges={excludedRanges}
          height={130}
        />
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.palette.slate.bg },
  content: { paddingHorizontal: 16, paddingBottom: 120, gap: 16 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headMeta: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
  },
  instrument: { gap: 6 },
  readout: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  unit: { color: theme.palette.slate.textSecondary, fontSize: 15, fontWeight: '700', bottom: 16 },
  alertsBlock: {
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.palette.yellow.color,
    backgroundColor: theme.alpha(theme.palette.yellow.bg, 0.3),
  },
  alertsHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  alertsTitle: { color: theme.palette.slate.textPrimary, fontSize: 18, fontWeight: '700' },
  levelRow: { flexDirection: 'row', gap: 8 },
  level: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.alpha(theme.palette.yellow.border, 0.6),
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelLabel: { fontSize: 13, fontWeight: '800' },
  alertsNote: { color: theme.palette.slate.textSecondary, fontSize: 12, lineHeight: 18 },
  chart: { marginHorizontal: -4 },
})
