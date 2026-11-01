import { StyleSheet, View } from 'react-native'
import {
  BatteryMediumIcon,
  ClockIcon,
  GaugeIcon,
  LightningIcon,
  MapPinIcon,
  RoadHorizonIcon,
  ThermometerHotIcon,
  ThermometerSimpleIcon,
  DeviceMobileIcon,
  UserCircleIcon,
  type Icon,
} from 'phosphor-react-native'
import { Text } from '@/components/base/Text'
import { theme, type ThemeColor } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

export interface Metric {
  label: string
  value: string
  unit: string
  icon: Icon
  color: ThemeColor
}
export const speed: Metric = {
  label: 'Speed',
  value: '22.4',
  unit: 'km/h',
  icon: GaugeIcon,
  color: theme.telemetry.speed,
}
export const battery: Metric = {
  label: 'Board battery',
  value: '84',
  unit: '%',
  icon: BatteryMediumIcon,
  color: theme.palette.green.color,
}
export const distance: Metric = {
  label: 'Ride distance',
  value: '3.2',
  unit: 'km',
  icon: RoadHorizonIcon,
  color: theme.palette.sky.color,
}
export const duration: Metric = {
  label: 'Ride time',
  value: '18',
  unit: 'min',
  icon: ClockIcon,
  color: theme.palette.purple.color,
}
export const voltage: Metric = {
  label: 'Voltage',
  value: '79.1',
  unit: 'V',
  icon: LightningIcon,
  color: theme.telemetry.battVoltage,
}
export const controller: Metric = {
  label: 'Controller',
  value: '38',
  unit: '°C',
  icon: ThermometerHotIcon,
  color: theme.telemetry.controllerTemp,
}
export const motor: Metric = {
  label: 'Motor',
  value: '46',
  unit: '°C',
  icon: ThermometerSimpleIcon,
  color: theme.telemetry.motorTemp,
}
export const phone: Metric = {
  label: 'Phone charge',
  value: '81',
  unit: '%',
  icon: DeviceMobileIcon,
  color: theme.palette.purple.color,
}
export function Readout({
  item,
  active,
  compact = false,
  row = false,
}: {
  item: Metric
  active: boolean
  compact?: boolean
  row?: boolean
}) {
  const n = useResolvedNeutralColors()
  const Glyph = item.icon
  return (
    <View style={row ? [s.readoutRow, { borderBottomColor: n.border }] : s.metric}>
      <View style={[s.inline, row && s.flex]}>
        <Glyph
          size={row || compact ? 17 : 20}
          color={active ? item.color : theme.neutral.textMuted}
          weight="duotone"
        />
        <Text style={s.caption}>{item.label}</Text>
      </View>
      <View style={s.valueLine}>
        <Text style={[s.number, (compact || row) && s.compactNumber]}>
          {active ? item.value : '—'}
        </Text>
        <Text style={s.unit}>{item.unit}</Text>
      </View>
    </View>
  )
}
export function PreviewMap({ active, large = false }: { active: boolean; large?: boolean }) {
  const n = useResolvedNeutralColors()
  return (
    <View style={[s.map, { height: large ? 210 : 150, backgroundColor: n.surface }]}>
      {[10, 38, 70, 95].map((x) => (
        <View key={x} style={[s.street, { left: `${x}%`, backgroundColor: n.border }]} />
      ))}
      {[24, 62, 92].map((y) => (
        <View key={y} style={[s.cross, { top: `${y}%`, backgroundColor: n.border }]} />
      ))}
      <Text style={s.mapLabel}>SKARYSZEWSKI PARK</Text>
      <View style={s.you}>
        <MapPinIcon size={22} color={theme.palette.cyan.color} />
        <Text style={s.small}>You</Text>
      </View>
      <View style={s.maja}>
        <UserCircleIcon
          size={32}
          color={active ? theme.palette.green.color : theme.palette.amber.color}
        />
        <Text style={s.body}>Maja</Text>
      </View>
      <Text style={s.mapFoot}>
        {active ? 'Illustrative map · live location' : 'Illustrative map · last location, 2h ago'}
      </Text>
    </View>
  )
}
export const s = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  header: { alignItems: 'center', justifyContent: 'center', paddingTop: 6, paddingBottom: 12 },
  content: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 26, gap: 20 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  identity: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  name: { fontSize: 23, fontWeight: '700', color: theme.neutral.textPrimary, marginBottom: 4 },
  profileName: { fontSize: 30, fontWeight: '700', color: theme.neutral.textPrimary },
  caption: { fontSize: 11, lineHeight: 16, color: theme.neutral.textSecondary },
  small: { fontSize: 10, lineHeight: 15, color: theme.neutral.textMuted },
  body: { fontSize: 13, fontWeight: '600', color: theme.neutral.textPrimary },
  eyebrow: { fontSize: 9, letterSpacing: 1.4, fontWeight: '700', color: theme.neutral.textMuted },
  board: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  boardName: { fontSize: 14, fontWeight: '700', color: theme.neutral.textPrimary, lineHeight: 23 },
  heroBoard: { fontSize: 22, fontWeight: '700', color: theme.neutral.textPrimary },
  stats: { flexDirection: 'row', gap: 14 },
  metric: { flex: 1, gap: 9 },
  number: { fontSize: 27, fontFamily: theme.mono('700'), color: theme.neutral.textPrimary },
  compactNumber: { fontSize: 20 },
  valueLine: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  unit: { fontSize: 10, color: theme.neutral.textSecondary },
  mediumNumber: { fontSize: 24, fontFamily: theme.mono('600'), color: theme.neutral.textPrimary },
  locationStrip: { paddingVertical: 3 },
  start: { alignSelf: 'flex-start' },
  boardHero: { alignItems: 'center', gap: 4, marginTop: -12 },
  boardStage: { height: 112, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  batteryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  readoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  telemetryHeader: { flexDirection: 'row', alignItems: 'center' },
  twoColumns: { flexDirection: 'row', gap: 24 },
  tripHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tripNumber: { fontSize: 46, fontFamily: theme.mono('700'), color: theme.neutral.textPrimary },
  journey: { gap: 24, paddingVertical: 4, paddingLeft: 2 },
  journeyLine: { position: 'absolute', left: 12, top: 20, bottom: 25, width: 1 },
  journeyStop: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  ring: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    marginHorizontal: 4,
    backgroundColor: theme.neutral.bg,
  },
  centered: { alignItems: 'center', gap: 10 },
  centeredLabel: { textAlign: 'center', alignItems: 'center' },
  minimalBoard: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  offline: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  map: { borderRadius: 16, overflow: 'hidden' },
  street: { position: 'absolute', height: '160%', width: 3, transform: [{ rotate: '28deg' }] },
  cross: { position: 'absolute', width: '120%', height: 3, transform: [{ rotate: '-15deg' }] },
  mapLabel: {
    position: 'absolute',
    top: 16,
    left: 16,
    letterSpacing: 1.8,
    fontSize: 9,
    color: theme.neutral.textMuted,
  },
  you: { position: 'absolute', top: 68, left: 36, alignItems: 'center' },
  maja: { position: 'absolute', top: 105, right: 55, alignItems: 'center' },
  mapFoot: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    fontSize: 9,
    color: theme.neutral.textMuted,
  },
  switcher: { padding: 9, marginHorizontal: 16, borderWidth: 1, borderRadius: 20, gap: 7 },
})
