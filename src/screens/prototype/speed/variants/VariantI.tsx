/** PROTOTYPE — Variant I: not the speed screen at all. The battery/cells screen a rider with a
 * smart BMS actually wants: which cell is dragging the pack down, how far it drifts, what the sag
 * under load says about real range, and whether any of it is worth worrying about today. */
import { ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  BatteryChargingIcon,
  HeartbeatIcon,
  ThermometerSimpleIcon,
  WarningIcon,
} from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

import { HeroBack, type VariantProps } from '../kit'
import { MOCK_CELLS, MOCK_PACK, MOCK_RIDE } from '../mock'

const COLUMNS = 5

export function VariantI(_: VariantProps) {
  const insets = useSafeAreaInsets()
  const mean = MOCK_CELLS.reduce((a, b) => a + b, 0) / MOCK_CELLS.length
  const min = Math.min(...MOCK_CELLS)
  const max = Math.max(...MOCK_CELLS)
  const delta = max - min
  const weakestIndex = MOCK_CELLS.indexOf(min)
  const drifting = delta > 0.05

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 4 }]}
    >
      <View style={styles.head}>
        <HeroBack label="Pack" />
        <View style={styles.flex} />
        <Text style={styles.headMeta}>20s2p · smart BMS</Text>
      </View>

      <View style={styles.summary}>
        <View style={styles.summaryMain}>
          <Text style={styles.packVolts}>{MOCK_PACK.packVolts.toFixed(1)}</Text>
          <Text style={styles.packUnit}>V</Text>
          <View style={styles.flex} />
          <View style={styles.socPill}>
            <BatteryChargingIcon size={16} color={theme.palette.green.color} weight="duotone" />
            <Text style={styles.socText}>{MOCK_RIDE.batteryPct}%</Text>
          </View>
        </View>
        <View style={styles.metaRow}>
          <Meta
            icon={HeartbeatIcon}
            tone={theme.palette.green.color}
            label="health"
            value={`${MOCK_PACK.healthPct}%`}
          />
          <Meta
            icon={ThermometerSimpleIcon}
            tone={theme.palette.orange.color}
            label="pack temp"
            value={`${MOCK_PACK.tempC} °C`}
          />
          <Meta
            icon={BatteryChargingIcon}
            tone={theme.palette.cyan.color}
            label="cycles"
            value={`${MOCK_PACK.cycles}`}
          />
        </View>
      </View>

      <View style={[styles.verdict, drifting ? styles.verdictWarn : styles.verdictOk]}>
        <WarningIcon
          size={18}
          color={drifting ? theme.palette.orange.color : theme.palette.green.color}
          weight="duotone"
        />
        <Text style={styles.verdictText}>
          {drifting
            ? `Cell ${weakestIndex + 1} sits ${((mean - min) * 1000).toFixed(0)} mV under the pack. Fine to ride — charge to full and let it balance.`
            : 'Every cell within 20 mV. Nothing to do.'}
        </Text>
      </View>

      <View style={styles.deltaRow}>
        <Text style={styles.deltaLabel}>spread</Text>
        <View style={styles.deltaTrack}>
          <View
            style={[
              styles.deltaFill,
              {
                width: `${Math.min(100, (delta / 0.3) * 100)}%`,
                backgroundColor: drifting ? theme.palette.orange.color : theme.palette.green.color,
              },
            ]}
          />
          <View style={[styles.deltaMark, { left: `${(0.05 / 0.3) * 100}%` }]} />
        </View>
        <Text style={styles.deltaValue}>{(delta * 1000).toFixed(0)} mV</Text>
      </View>

      <Text style={styles.sectionLabel}>CELLS</Text>
      <View style={styles.grid}>
        {MOCK_CELLS.map((cell, index) => {
          const drift = cell - mean
          const weak = index === weakestIndex
          const tone =
            drift < -0.05
              ? theme.palette.orange
              : drift > 0.02
                ? theme.palette.green
                : theme.palette.slate
          return (
            <View
              key={index}
              style={[
                styles.cell,
                {
                  width: `${100 / COLUMNS - 2}%`,
                  borderColor: weak ? tone.color : theme.palette.slate.border,
                },
              ]}
            >
              <Text style={styles.cellIndex}>{index + 1}</Text>
              <Text style={[styles.cellVolts, weak && { color: tone.color }]}>
                {cell.toFixed(2)}
              </Text>
              <View style={styles.cellBarTrack}>
                <View
                  style={[
                    styles.cellBarFill,
                    {
                      width: `${Math.min(100, Math.max(6, ((cell - 3.7) / (4.2 - 3.7)) * 100))}%`,
                      backgroundColor: weak
                        ? tone.color
                        : theme.alpha(theme.palette.green.color, 0.6),
                    },
                  ]}
                />
              </View>
              <Text style={styles.cellDrift}>
                {drift >= 0 ? '+' : ''}
                {(drift * 1000).toFixed(0)}
              </Text>
            </View>
          )
        })}
      </View>

      <Text style={styles.sectionLabel}>UNDER LOAD</Text>
      <View style={styles.sagCard}>
        <View style={styles.sagRow}>
          <Text style={styles.sagValue}>{MOCK_PACK.sagAt30A.toFixed(1)} V</Text>
          <Text style={styles.sagLabel}>at 30 A this ride</Text>
        </View>
        <Text style={styles.sagNote}>
          {MOCK_RIDE.sagVolts} V of sag — normal for this pack at {MOCK_RIDE.batteryPct}%. Range
          left ≈ <Text style={styles.sagStrong}>{MOCK_RIDE.rangeKm} km</Text> (±
          {MOCK_RIDE.rangeConfidenceKm} km at your pace).
        </Text>
      </View>
    </ScrollView>
  )
}

function Meta({
  icon: Icon,
  tone,
  label,
  value,
}: {
  icon: typeof HeartbeatIcon
  tone: string
  label: string
  value: string
}) {
  return (
    <View style={styles.meta}>
      <Icon size={15} color={tone} weight="duotone" />
      <Text style={styles.metaValue}>{value}</Text>
      <Text style={styles.metaLabel}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.palette.slate.bg },
  content: { paddingHorizontal: 16, paddingBottom: 120, gap: 12 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headMeta: { color: theme.palette.slate.textMuted, fontSize: 12 },
  summary: { gap: 10 },
  summaryMain: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  packVolts: { color: theme.palette.slate.textPrimary, fontSize: 44, fontWeight: '800' },
  packUnit: { color: theme.palette.slate.textSecondary, fontSize: 16, marginBottom: 8 },
  socPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.palette.green.border,
  },
  socText: { color: theme.palette.green.color, fontSize: 13, fontWeight: '800' },
  metaRow: { flexDirection: 'row', gap: 18 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaValue: { color: theme.palette.slate.textPrimary, fontSize: 13, fontWeight: '700' },
  metaLabel: { color: theme.palette.slate.textMuted, fontSize: 11 },
  verdict: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'flex-start',
  },
  verdictWarn: { borderColor: theme.alpha(theme.palette.orange.color, 0.6) },
  verdictOk: { borderColor: theme.palette.green.border },
  verdictText: { flex: 1, color: theme.palette.slate.textSecondary, fontSize: 12, lineHeight: 18 },
  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  deltaLabel: { color: theme.palette.slate.textMuted, fontSize: 11, width: 44 },
  deltaTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.85),
    overflow: 'hidden',
  },
  deltaFill: { height: '100%', borderRadius: 3 },
  deltaMark: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: theme.palette.slate.light,
  },
  deltaValue: {
    color: theme.palette.slate.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    width: 54,
    textAlign: 'right',
  },
  sectionLabel: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 4,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cell: {
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    gap: 3,
    alignItems: 'center',
  },
  cellIndex: { color: theme.palette.slate.textDim, fontSize: 9 },
  cellVolts: { color: theme.palette.slate.textPrimary, fontSize: 13, fontWeight: '700' },
  cellBarTrack: {
    width: '100%',
    height: 3,
    borderRadius: 2,
    backgroundColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.85),
    overflow: 'hidden',
  },
  cellBarFill: { height: '100%' },
  cellDrift: { color: theme.palette.slate.textMuted, fontSize: 9 },
  sagCard: {
    gap: 8,
    padding: 14,
    borderRadius: 14,
    backgroundColor: theme.palette.slate.surface,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
  },
  sagRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  sagValue: { color: theme.palette.slate.textPrimary, fontSize: 24, fontWeight: '700' },
  sagLabel: { color: theme.palette.slate.textMuted, fontSize: 12 },
  sagNote: { color: theme.palette.slate.textSecondary, fontSize: 12, lineHeight: 18 },
  sagStrong: { color: theme.palette.slate.textPrimary, fontWeight: '700' },
})
