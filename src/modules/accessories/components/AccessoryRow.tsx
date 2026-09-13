import { Pressable, StyleSheet, View } from 'react-native'
import { WarningCircleIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { AccessoryIcon } from '@/modules/accessories/constants/accessoryIcon'
import { accessoryStatusCopy } from '@/modules/accessories/lib/accessoryStatus'
import type { AccessoryLinkPhase } from 'vescape-core'
import { interaction, theme } from '@/constants/theme'

const TONE = {
  success: theme.status.success.color,
  neutral: theme.neutral.textDim,
  caution: theme.status.caution.color,
} as const

export interface AccessoryRowProps {
  name: string
  /** Firmware version, or whatever secondary fact best identifies this unit. */
  detail?: string | undefined
  /** Native's link phase. Never derived here — this row phrases it and nothing else. */
  phase: AccessoryLinkPhase
  /** True when saved settings can no longer be trusted: changed limits, or nothing usable left. */
  needsSetup?: boolean
  onPress: () => void
}

/**
 * One Accessory in the Board selector's Accessories section: what it is, whether the app is
 * hearing it, and a way into its configuration.
 *
 * Deliberately dumb — it takes strings and a status, never a store or a manifest, so the same row
 * serves the selector, the showcase, and whatever screen lists Accessories next.
 */
export function AccessoryRow({ name, detail, phase, needsSetup, onPress }: AccessoryRowProps) {
  const copy = accessoryStatusCopy(phase)
  const label = needsSetup ? 'Setup required' : copy.label
  const tone = needsSetup ? TONE.caution : TONE[copy.tone]
  const warn = needsSetup || phase === 'incompatible'

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${label}`}
      testID={`accessory-row-${name}`}
    >
      <View style={styles.icon}>
        {warn ? (
          <WarningCircleIcon size={16} color={TONE.caution} weight="duotone" />
        ) : (
          <AccessoryIcon size={16} color={theme.neutral.textMuted} weight="regular" />
        )}
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <View style={styles.metaLine}>
          <View
            style={[
              styles.dot,
              {
                borderColor: tone,
                // Filled only while the link is actually up: a hollow dot is the honest shape for
                // "trying", and a filled one must never promise a connection there isn't.
                backgroundColor: phase === 'connected' && !warn ? tone : 'transparent',
              },
            ]}
          />
          <Text style={[styles.meta, { color: tone }]}>{label}</Text>
          {detail ? (
            <>
              <Text style={styles.meta}>·</Text>
              <Text style={styles.meta} numberOfLines={1}>
                {detail}
              </Text>
            </>
          ) : null}
        </View>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    gap: 10,
  },
  rowPressed: {
    backgroundColor: interaction.pressedBg,
  },
  // Matches the board rows' tile: same size and place, so the two sections read as one list.
  icon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.alpha(theme.neutral.border, 0.6),
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    gap: 3,
  },
  name: {
    color: theme.neutral.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  metaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    borderWidth: 1.5,
  },
  meta: {
    color: theme.neutral.textDim,
    fontSize: 11,
    lineHeight: 14,
  },
})
