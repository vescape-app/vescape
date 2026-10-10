import { ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { TextAaIcon } from 'phosphor-react-native'

import { IconHero } from '@/components/settings/IconHero'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

/** Design-system typography roles (mirrors `docs/design.md` Typography table). */
const ROLES = [
  {
    role: 'Screen title',
    sample: 'Dashboard',
    size: 20,
    weight: '700',
    color: theme.neutral.textPrimary,
  },
  {
    role: 'Row label',
    sample: 'Board name',
    size: 15,
    weight: '600',
    color: theme.neutral.textPrimary,
  },
  {
    role: 'Row hint',
    sample: 'Tap to edit',
    size: 12,
    weight: '500',
    color: theme.neutral.textMuted,
  },
  {
    role: 'Section title',
    sample: 'GENERAL',
    size: 13,
    weight: '700',
    color: theme.neutral.textMuted,
  },
  {
    role: 'Metadata',
    sample: 'v0.76.0',
    size: 12,
    weight: '500',
    color: theme.neutral.textSecondary,
  },
  {
    role: 'Stepper value',
    sample: '12.5',
    size: 15,
    weight: '700',
    color: theme.neutral.textPrimary,
  },
] as const

/** Weight sweep to verify numeric fontWeight resolves to the static Raleway instances. */
const WEIGHTS = [
  { label: '400', sample: 'The quick brown fox', weight: '400' },
  { label: '500', sample: 'The quick brown fox', weight: '500' },
  { label: '600', sample: 'The quick brown fox', weight: '600' },
  { label: '700', sample: 'The quick brown fox', weight: '700' },
  { label: '800', sample: 'The quick brown fox', weight: '800' },
] as const

/** Numeric readout parity check — Raleway `tabular-nums` keeps numeric columns aligned. */
const TABULAR_ROWS = ['12.345', '6.789', '123.0']

export default function TypographyComponentsPage() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={TextAaIcon}
          description="Raleway across every UI text role. Weights, tokens, and tabular-nums sanity check."
        />

        <ShowcaseCard name="Typography roles">
          <View style={styles.col}>
            {ROLES.map((r) => (
              <View key={r.role} style={styles.roleRow}>
                <Text style={styles.roleName}>{r.role}</Text>
                <Text
                  style={{
                    color: r.color,
                    fontSize: r.size,
                    fontWeight: r.weight,
                  }}
                >
                  {r.sample}
                </Text>
              </View>
            ))}
          </View>
        </ShowcaseCard>

        <ShowcaseCard name="Font weights">
          <View style={styles.col}>
            {WEIGHTS.map((w) => (
              <View key={w.label} style={styles.weightRow}>
                <Text style={styles.weightLabel}>{w.label}</Text>
                <Text style={{ fontSize: 16, fontWeight: w.weight }}>{w.sample}</Text>
              </View>
            ))}
          </View>
        </ShowcaseCard>

        <ShowcaseCard name="Tabular nums">
          <View style={styles.col}>
            {TABULAR_ROWS.map((row) => (
              <Text
                key={row}
                style={{
                  color: theme.neutral.textPrimary,
                  fontSize: 24,
                  fontWeight: '700',
                  fontVariant: ['tabular-nums'],
                }}
              >
                {row}
              </Text>
            ))}
          </View>
          <Text style={styles.hint}>Raleway UI font with fontVariant tabular-nums.</Text>
        </ShowcaseCard>

        <ShowcaseCard name="Monospace">
          <View style={styles.col}>
            <Text style={{ fontSize: 14, fontFamily: 'monospace' }}>event_log: boot ok</Text>
            <Text style={{ fontSize: 14, fontFamily: 'monospace' }}>imu: 0.0123 0.0045 1.0</Text>
          </View>
          <Text style={styles.hint}>
            Readouts opt out of Raleway via fontFamily: &apos;monospace&apos;.
          </Text>
        </ShowcaseCard>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
  col: { gap: 8 },
  roleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  roleName: {
    fontSize: 12,
    fontWeight: '500',
    color: theme.neutral.textSecondary,
  },
  weightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  weightLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.neutral.textMuted,
    width: 36,
  },
  hint: {
    fontSize: 12,
    color: theme.neutral.textMuted,
  },
})
