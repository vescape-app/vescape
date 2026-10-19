import { Pressable, StyleSheet, View } from 'react-native'
import type { Icon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import {
  useColoredAction,
  useColoredActionForeground,
  useResolvedColor,
  useResolvedNeutralColors,
} from '@/hooks/useTheme'
import type { tuneProfileColorTheme } from '@/modules/tune/components/TuneProfileMetadataModal'

const PROFILE_OPTION_WIDTH = 46
const PROFILE_ACTIVE_WIDTH = 126

interface TuneProfilePillProps {
  label: string
  icon: Icon
  active: boolean
  color: ReturnType<typeof tuneProfileColorTheme>
  onPress: () => void
}

export function TuneProfilePill({
  label,
  icon: IconComponent,
  active,
  color,
  onPress,
}: TuneProfilePillProps) {
  const neutral = useResolvedNeutralColors()
  const resolvedBackground = useColoredAction(color.color)
  const resolvedBorder = useColoredActionForeground(color.color)
  const resolvedColor = useResolvedColor(color.color)
  const activeColor = resolvedBorder
  const fadedColor = theme.alpha(resolvedColor, 0.6)
  return (
    <View
      style={[
        styles.profilePill,
        {
          width: active ? PROFILE_ACTIVE_WIDTH : PROFILE_OPTION_WIDTH,
          backgroundColor: active ? resolvedBackground : neutral.surfaceDeep,
          borderColor: active ? resolvedBorder : neutral.border,
        },
      ]}
    >
      <Pressable
        style={({ pressed }) => [styles.profilePillPressable, pressed && styles.profilePillPressed]}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: active }}
        onPress={onPress}
      >
        <IconComponent size={18} color={active ? activeColor : fadedColor} weight="duotone" />
        {active ? (
          <Text
            style={[styles.profilePillText, { color: activeColor, marginLeft: 7, flexShrink: 1 }]}
            numberOfLines={1}
          >
            {label}
          </Text>
        ) : null}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  profilePill: {
    width: PROFILE_OPTION_WIDTH,
    height: PROFILE_OPTION_WIDTH,
    borderRadius: PROFILE_OPTION_WIDTH / 2,
    borderWidth: 1,
    overflow: 'hidden',
  },
  profilePillPressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  profilePillPressed: {
    backgroundColor: theme.neutral.surface,
  },
  profilePillText: {
    color: theme.neutral.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
})
