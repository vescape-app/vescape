import { Pressable, StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { AccessoryIcon } from '@/modules/accessories/constants/accessoryIcon'
import { accessoryStatusCopy } from '@/modules/accessories/lib/accessoryStatus'
import type { AccessoryLinkPhase } from 'vescape-core'
import { interaction, theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

const TONE = {
  success: theme.status.success.color,
  neutral: theme.neutral.textDim,
  caution: theme.status.caution.color,
} as const

export interface AccessoryRowProps {
  name: string
  detail?: string | undefined
  phase: AccessoryLinkPhase
  needsSetup?: boolean
  onPress: () => void
}

export function AccessoryRow({ name, detail, phase, needsSetup, onPress }: AccessoryRowProps) {
  const neutral = useResolvedNeutralColors()
  const copy = accessoryStatusCopy(phase)
  const label = needsSetup ? 'Setup required' : copy.label
  const tone = needsSetup ? TONE.caution : TONE[copy.tone]
  const warn = needsSetup || phase === 'incompatible'
  const live = phase === 'connected' && !warn

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${label}`}
      testID={`accessory-row-${name}`}
    >
      <View
        style={[
          styles.icon,
          { borderColor: theme.alpha(neutral.border, 0.6) },
          (live || warn) && { borderColor: theme.alpha(tone, 0.3) },
        ]}
      >
        <AccessoryIcon
          size={16}
          color={live || warn ? tone : theme.neutral.textMuted}
          weight="regular"
        />
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
                backgroundColor: live ? tone : 'transparent',
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
  icon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
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
