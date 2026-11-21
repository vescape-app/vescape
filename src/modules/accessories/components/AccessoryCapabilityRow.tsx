import { Pressable, StyleSheet, View } from 'react-native'
import { CaretRightIcon } from 'phosphor-react-native'
import type { AccessoryCapability, AccessoryLinkPhase } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { capabilityPresentation } from '@/modules/accessories/constants/accessoryCapabilities'
import { capabilityStateCopy } from '@/modules/accessories/lib/capabilityStateCopy'
import { interaction, theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

export function AccessoryCapabilityRow({
  capability,
  phase,
  onPress,
}: {
  capability: AccessoryCapability
  phase?: AccessoryLinkPhase
  onPress?: () => void
}) {
  const neutral = useResolvedNeutralColors()
  const { title, description, icon: CapabilityIcon } = capabilityPresentation(capability)
  const off = capability.supported && capability.enabled === false
  const tint = !capability.supported
    ? theme.neutral.textDim
    : off
      ? theme.neutral.textMuted
      : theme.palette.sky.color
  const badge = !capability.supported
    ? { label: 'Unsupported', tint }
    : off
      ? { label: 'Off', tint: theme.status.caution.color }
      : null
  const state =
    phase === 'connected' && capability.supported && !off
      ? capabilityStateCopy(capability, phase)
      : null

  const body = (
    <>
      <View style={[styles.icon, { borderColor: theme.alpha(neutral.border, 0.6) }]}>
        <CapabilityIcon size={18} color={tint} weight="duotone" />
      </View>
      <View style={styles.body}>
        <View style={styles.titleLine}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {badge ? (
            <View style={[styles.badge, { borderColor: badge.tint }]}>
              <Text style={[styles.badgeText, { color: badge.tint }]}>{badge.label}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.description}>{description}</Text>
        {state ? <Text style={styles.state}>{state}</Text> : null}
      </View>
      {onPress ? <CaretRightIcon size={16} color={theme.neutral.textDim} weight="bold" /> : null}
    </>
  )

  if (!onPress) return <View style={styles.row}>{body}</View>

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Configure ${title}`}
      testID={`accessory-capability-${capability.id}`}
    >
      {body}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  rowPressed: { backgroundColor: interaction.pressedBg },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 3,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flexShrink: 1,
    color: theme.neutral.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  badge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  description: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  state: {
    color: theme.palette.sky.color,
    fontSize: 11,
    fontWeight: '600',
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
})
