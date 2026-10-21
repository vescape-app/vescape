import type { TuneProfileFieldValue } from 'vescape-core'
import { tuneProfileSummary, type TuneProfileSummary } from '@/modules/tune/lib/profileSummary'
import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { cloneElement, isValidElement, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import {
  FadersIcon,
  PencilSimpleIcon,
  LightningIcon,
  PathIcon,
  MountainsIcon,
} from 'phosphor-react-native'
import { Text } from '@/components/base/Text'
import { interaction, theme } from '@/constants/theme'
import { useResolvedColor, useResolvedNeutralColors } from '@/hooks/useTheme'
import {
  tuneProfileColorTheme,
  tuneProfileIconComponent,
} from '@/modules/tune/components/TuneProfileMetadataModal'

interface Profile {
  name: string
  color: string
  fields?: Record<string, TuneProfileFieldValue>
  icon?: string
}

export function TuneProfileSelectCard({
  activeProfile,
  children,
  onEdit,
  title,
  stats,
  emptyLabel = 'No profile',
}: {
  activeProfile: Profile | null
  children?: ReactNode
  onEdit: () => void
  title?: boolean
  stats?: TuneProfileSummary
  emptyLabel?: string
}) {
  const [headerWidth, setHeaderWidth] = useState(0)
  const selector =
    title && headerWidth > 0 && isValidElement<{ style?: StyleProp<ViewStyle> }>(children)
      ? cloneElement(children, { style: [children.props.style, { maxWidth: headerWidth }] })
      : children
  const neutral = useResolvedNeutralColors()
  const surface = useResolvedSecondaryWidgetSurface()
  const accent = tuneProfileColorTheme(activeProfile?.color ?? 'purple')
  const ProfileIcon = tuneProfileIconComponent(activeProfile?.icon)
  const foreground = useResolvedColor(activeProfile ? accent.text : neutral.textMuted)
  const summary = stats ?? (activeProfile?.fields ? tuneProfileSummary(activeProfile.fields) : null)
  const metrics = summary
    ? [
        { label: 'Aggression', Icon: LightningIcon, value: summary.aggression },
        { label: 'Turning', Icon: PathIcon, value: summary.turning },
        { label: 'ATR', Icon: MountainsIcon, value: summary.atr },
      ]
    : []
  return (
    <View style={[styles.card, surface]}>
      <View
        style={title ? styles.topRow : undefined}
        onLayout={(event) => setHeaderWidth(event.nativeEvent.layout.width)}
      >
        {title ? (
          <View style={styles.heading}>
            <FadersIcon size={24} color={accent.color} weight="duotone" />
            <View style={styles.headingText}>
              <Text style={styles.title}>Tune</Text>
              {!activeProfile && !children ? (
                <Text style={[styles.description, { color: neutral.textSecondary }]}>
                  Pick how your board should feel.
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}
        {selector}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={activeProfile ? `Edit ${activeProfile.name}` : 'Create tune'}
        onPress={onEdit}
        style={({ pressed }) => [
          styles.footer,
          {
            borderTopColor: neutral.border,
          },
          children ? styles.footerDivider : null,
          pressed && { opacity: interaction.pressedOpacity },
        ]}
      >
        <View style={styles.footerHeading}>
          <ProfileIcon size={18} color={foreground} weight="duotone" />
          <Text numberOfLines={1} style={[styles.name, { color: foreground }]}>
            {activeProfile?.name ?? emptyLabel}
          </Text>
          <View style={styles.editHint}>
            <PencilSimpleIcon size={18} color={foreground} weight="duotone" />
            <Text style={[styles.editLabel, { color: foreground }]}>
              {activeProfile ? 'Edit' : 'Create'}
            </Text>
          </View>
        </View>
        {metrics.length > 0 ? (
          <View style={styles.metrics}>
            {metrics.map(({ label, Icon, value }) => (
              <View
                key={label}
                style={styles.metric}
                accessibilityLabel={
                  value == null ? `${label}: unavailable` : `${label}: ${value} of 5`
                }
              >
                <View style={styles.metricHeading}>
                  <Icon size={15} color={foreground} weight="duotone" />
                  <Text style={[styles.metricLabel, { color: neutral.textSecondary }]}>
                    {label}
                  </Text>
                </View>
                {value == null ? (
                  <Text style={[styles.missing, { color: neutral.textMuted }]}>—</Text>
                ) : (
                  <View style={styles.segments}>
                    {Array.from({ length: 5 }, (_, index) => (
                      <View
                        key={index}
                        style={[
                          styles.segment,
                          { backgroundColor: index < value ? foreground : neutral.border },
                        ]}
                      />
                    ))}
                  </View>
                )}
              </View>
            ))}
          </View>
        ) : null}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 20, padding: 14, gap: 14, overflow: 'hidden' },
  topRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  headingText: { flexShrink: 1, gap: 3 },
  description: { fontSize: 13 },
  title: { color: theme.neutral.textPrimary, fontSize: 18, fontWeight: '800' },
  footer: {
    gap: 14,
    minHeight: 60,
    marginHorizontal: -14,
    marginBottom: -14,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  footerHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  metrics: { flexDirection: 'row', gap: 18 },
  metric: { flex: 1, gap: 8 },
  metricHeading: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metricLabel: { fontSize: 10, fontWeight: '600' },
  missing: { fontSize: 12, lineHeight: 12 },
  segments: { flexDirection: 'row', gap: 3 },
  segment: { flex: 1, height: 4, borderRadius: 2 },
  footerDivider: { borderTopWidth: 1 },
  editHint: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  editLabel: { fontSize: 13, fontWeight: '700' },
  name: { flex: 1, color: theme.neutral.textPrimary, fontSize: 13, fontWeight: '700' },
})
