import type { ReactNode } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { GearSixIcon, TrashIcon } from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import {
  useResolvedControlColors,
  useResolvedNeutralColors,
  useResolvedTelemetryColors,
  useThemeStore,
} from '@/hooks/useTheme'

function Swatch({ name, color }: { name: string; color: string }) {
  return (
    <View style={styles.swatchRow}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text style={styles.swatchName}>{name}</Text>
      <Text style={styles.swatchValue}>{color.toUpperCase()}</Text>
    </View>
  )
}

function ThemeSection({ name, children }: { name: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionName}>{name}</Text>
      {children}
    </View>
  )
}

export default function ThemeShowcase() {
  const appearance = useThemeStore((state) => state.resolvedTheme)
  const neutral = useResolvedNeutralColors()
  const control = useResolvedControlColors()
  const telemetry = useResolvedTelemetryColors()

  return (
    <ScrollView
      style={styles.screen}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
    >
      <Text style={styles.intro}>
        Active appearance: {appearance}. White is the content canvas; navy identifies interaction.
      </Text>

      <ThemeSection name="Canvas and copy">
        <View style={styles.flatPreview}>
          <Text style={styles.primary}>Primary content lives directly on the canvas.</Text>
          <Text style={styles.secondary}>Secondary information stays readable without a card.</Text>
          <View style={styles.separator} />
          <Text style={styles.muted}>Spacing and thin separators provide hierarchy.</Text>
        </View>
      </ThemeSection>

      <ThemeSection name="Interactive navy">
        <View style={[styles.controlPreview, { backgroundColor: control.background }]}>
          <GearSixIcon size={22} color={control.icon} weight="bold" />
          <View style={styles.controlCopy}>
            <Text style={[styles.controlTitle, { color: control.text }]}>Interactive surface</Text>
            <Text style={[styles.controlHint, { color: control.textMuted }]}>
              Tap, select or edit
            </Text>
          </View>
          <View style={[styles.controlDivider, { backgroundColor: control.divider }]} />
          <Text style={[styles.controlTitle, { color: control.text }]}>Open</Text>
        </View>
      </ThemeSection>

      <ThemeSection name="Shared actions">
        <View style={styles.actionRow}>
          <IconButton icon={GearSixIcon} onPress={() => undefined} accessibilityLabel="Settings" />
          <IconButton
            icon={TrashIcon}
            destructive
            onPress={() => undefined}
            accessibilityLabel="Delete"
          />
          <Button label="Continue" onPress={() => undefined} />
          <Button label="Disabled" disabled onPress={() => undefined} />
        </View>
      </ThemeSection>

      <ThemeSection name="Telemetry on canvas">
        <View style={styles.telemetryGrid}>
          {Object.entries(telemetry).map(([name, color]) => (
            <Swatch key={name} name={name} color={color} />
          ))}
        </View>
      </ThemeSection>

      <ThemeSection name="Resolved tokens">
        <View style={styles.tokenColumns}>
          <View style={styles.tokenColumn}>
            <Text style={styles.columnTitle}>Neutral</Text>
            {Object.entries(neutral).map(([name, color]) => (
              <Swatch key={name} name={name} color={color} />
            ))}
          </View>
          <View style={styles.tokenColumn}>
            <Text style={styles.columnTitle}>Control</Text>
            {Object.entries(control).map(([name, color]) => (
              <Swatch key={name} name={name} color={color} />
            ))}
          </View>
        </View>
      </ThemeSection>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
  intro: { color: theme.neutral.textSecondary, fontSize: 13, lineHeight: 19 },
  section: {
    gap: 10,
    paddingHorizontal: 2,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.neutral.border,
  },
  sectionName: {
    color: theme.palette.sky.color,
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  flatPreview: { gap: 8, paddingVertical: 6 },
  primary: { color: theme.neutral.textPrimary, fontSize: 16, fontWeight: '700' },
  secondary: { color: theme.neutral.textSecondary, fontSize: 13 },
  muted: { color: theme.neutral.textMuted, fontSize: 12 },
  separator: { height: 1, backgroundColor: theme.neutral.border },
  controlPreview: {
    minHeight: 58,
    borderRadius: 29,
    borderWidth: 1,
    borderColor: theme.control.border,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  controlCopy: { flex: 1, gap: 2 },
  controlTitle: { fontSize: 13, fontWeight: '800' },
  controlHint: { fontSize: 11, fontWeight: '500' },
  controlDivider: { width: 1, height: 26 },
  actionRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  telemetryGrid: { gap: 6 },
  swatchRow: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.neutral.border,
  },
  swatchName: { flex: 1, color: theme.neutral.textPrimary, fontSize: 12, fontWeight: '600' },
  swatchValue: { color: theme.neutral.textMuted, fontFamily: 'monospace', fontSize: 10 },
  tokenColumns: { gap: 16 },
  tokenColumn: { gap: 5 },
  columnTitle: { color: theme.neutral.textPrimary, fontSize: 13, fontWeight: '800' },
})
