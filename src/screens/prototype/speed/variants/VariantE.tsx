/** PROTOTYPE — Variant E: "Fused instrument". Gauge and chart are one continuous instrument
 * (arc on top, trace welded underneath, no cards between them); alerts sit in a docked footer
 * block with the test action as the block's own affordance. */
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BellRingingIcon, PencilSimpleIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { IconButton } from '@/components/base/IconButton'
import { theme } from '@/constants/theme'
import { SingleGauge } from '@/modules/board/components/SingleGauge'
import { MetricDetailChart } from '@/modules/board/components/MetricDetailChart'

import {
  HeroBack,
  LEVELS,
  SPEED,
  TestButton,
  describeSpec,
  useDisplayValue,
  useSpeedAlertModel,
  type VariantProps,
} from '../kit'

export function VariantE({ controller, live, points, windowMs, excludedRanges }: VariantProps) {
  const insets = useSafeAreaInsets()
  const model = useSpeedAlertModel(controller)
  const value = useDisplayValue(live, model.alertTest)

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 4 }]}>
        <View style={styles.head}>
          <HeroBack label="Speed" />
          <View style={styles.flex} />
          <Text style={styles.headMeta}>{Math.round(model.max)} km/h scale</Text>
        </View>

        <View style={styles.instrument}>
          <SingleGauge
            value={value}
            min={0}
            max={model.max}
            color={SPEED.color}
            unit={SPEED.unit}
            alerts={model.markers}
            containerStyle={styles.gauge}
          />
          <View style={styles.seam} />
          <MetricDetailChart
            metric={SPEED}
            points={points}
            range={{ y: SPEED.chartRange }}
            windowMs={windowMs}
            excludedRanges={excludedRanges}
            height={150}
          />
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 64 }]}>
        <View style={styles.footerHead}>
          <BellRingingIcon size={18} color={theme.palette.yellow.color} weight="duotone" />
          <Text style={styles.footerTitle}>Alerts</Text>
          <View style={styles.flex} />
          <TestButton alertTest={model.alertTest} />
          <IconButton
            icon={PencilSimpleIcon}
            size="sm"
            accessibilityLabel="Edit alerts"
            onPress={() => controller?.customize()}
          />
        </View>

        <View style={styles.segments}>
          {LEVELS.map((level) => {
            const on = level.id === model.level
            return (
              <Pressable
                key={level.id}
                onPress={() => controller?.setLevel(level.id)}
                style={[
                  styles.segment,
                  on && { borderColor: level.tone.border, backgroundColor: level.tone.bg },
                ]}
              >
                <Text
                  style={[
                    styles.segmentLabel,
                    { color: on ? level.tone.color : theme.palette.slate.textMuted },
                  ]}
                >
                  {level.label}
                </Text>
              </Pressable>
            )
          })}
        </View>

        <Text style={styles.footerNote}>
          {model.specs.length === 0
            ? 'Nothing announced — you ride blind on speed.'
            : model.specs
                .map((spec) => {
                  const d = describeSpec(spec, model.max)
                  return `Beeps ${d.range}, ${d.cadence}.`
                })
                .join(' ')}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.palette.slate.bg },
  content: { paddingHorizontal: 16, paddingBottom: 24, gap: 8 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headMeta: { color: theme.palette.slate.textMuted, fontSize: 12 },
  instrument: {
    borderRadius: 16,
    backgroundColor: theme.palette.slate.surface,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
  },
  gauge: { backgroundColor: 'transparent', paddingHorizontal: 0 },
  seam: { height: 1, backgroundColor: theme.palette.slate.border, marginVertical: 8 },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
  footerHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footerTitle: { color: theme.palette.slate.textPrimary, fontSize: 18, fontWeight: '700' },
  segments: { flexDirection: 'row', gap: 8 },
  segment: {
    flex: 1,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentLabel: { fontSize: 13, fontWeight: '800' },
  footerNote: { color: theme.palette.slate.textSecondary, fontSize: 12, lineHeight: 18 },
})
