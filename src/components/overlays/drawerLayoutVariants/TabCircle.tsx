/** PROTOTYPE — round tab button shared by the drawer layout variants. */
import { Pressable, StyleSheet } from 'react-native'

import type { DrawerTab } from '@/components/overlays/TabbedEdgeDrawer'
import { theme } from '@/constants/theme'
import { useResolvedColor, useResolvedNeutralColors } from '@/hooks/useTheme'

export function TabCircle({
  tab,
  size,
  active,
  testID,
  onPress,
}: {
  tab: DrawerTab<string>
  size: number
  active: boolean
  testID?: string
  onPress: () => void
}) {
  const neutral = useResolvedNeutralColors()
  const color = useResolvedColor(tab.color)
  const IconComponent = tab.icon

  return (
    <Pressable
      style={({ pressed }) => [
        styles.tab,
        { width: size, height: size, borderRadius: size / 2 },
        active && {
          backgroundColor: theme.alpha(color, 0.12),
          borderColor: theme.alpha(color, 0.6),
        },
        pressed && !active && { backgroundColor: neutral.surface },
      ]}
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: active }}
      testID={testID}
      onPress={onPress}
    >
      <IconComponent
        size={Math.round(size * 0.42)}
        color={active ? color : neutral.textMuted}
        weight={active ? 'duotone' : 'regular'}
      />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  tab: {
    borderWidth: 1,
    borderColor: theme.alpha(theme.palette.mono.black, 0),
    alignItems: 'center',
    justifyContent: 'center',
  },
})
