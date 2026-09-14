import { Pressable, StyleSheet, View } from 'react-native'
import { CaretRightIcon } from 'phosphor-react-native'
import type { AccessoryCapability, AccessoryLinkPhase } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { capabilityPresentation } from '@/modules/accessories/constants/accessoryCapabilities'
import { capabilityStateCopy } from '@/modules/accessories/lib/capabilityStateCopy'
import { interaction, theme } from '@/constants/theme'

/**
 * One capability an Accessory declares, with what the app can do about it.
 *
 * An unsupported capability is shown rather than filtered out: a rider holding hardware Vescape
 * half-understands should be told which half, not handed a shorter list.
 *
 * A capability the rider switched off says so here too. Otherwise the list reads identically
 * whether or not the thing is actually doing anything, and the only way to find out is to open
 * every row.
 *
 * A row is only a way in when this build has a configuration screen for that capability type. An
 * unsupported capability, or a recognized one whose slice has not shipped, stays a flat row rather
 * than a tap that leads somewhere empty — [onPress] is simply absent.
 */
export function AccessoryCapabilityRow({
  capability,
  phase,
  onPress,
}: {
  capability: AccessoryCapability
  /** The link this capability lives on. Given, the row also says what it is doing right now. */
  phase?: AccessoryLinkPhase
  /** Omit when this capability has nothing to open. */
  onPress?: () => void
}) {
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
  // "Off" is already the badge's job, and the link phase is the screen header's — the state line is
  // for the half-second answer the list otherwise makes the rider open a row to get.
  const state =
    phase === 'connected' && capability.supported && !off
      ? capabilityStateCopy(capability, phase)
      : null

  const body = (
    <>
      <View style={styles.icon}>
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
    borderColor: theme.alpha(theme.neutral.border, 0.6),
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
