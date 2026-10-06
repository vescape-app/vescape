/** PROTOTYPE variant — horizontal tab bar grown sideways from the trigger, active tab widens into an icon + label capsule, view stacked above it full-width. */
import { Pressable, StyleSheet, View } from 'react-native'
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated'

import { Text } from '@/components/base/Text'
import type { DrawerTab } from '@/components/overlays/TabbedEdgeDrawer'
import type { DrawerLayoutVariantProps } from '@/components/overlays/drawerLayoutVariants/types'
import { theme } from '@/constants/theme'
import { useResolvedColor, useResolvedNeutralColors } from '@/hooks/useTheme'

const LAYOUT = LinearTransition.duration(220)

export function HorizontalBar({
  tabs,
  activeTab,
  onTabChange,
  testID,
  slotSize,
  outset,
  side,
  opensFromTop,
  bodyWidth,
  close,
  children,
}: DrawerLayoutVariantProps) {
  const neutral = useResolvedNeutralColors()
  const tab = tabs.find((candidate) => candidate.id === activeTab) ?? tabs[0]
  const IconComponent = tab.icon
  const direction = side === 'left' ? 'row' : 'row-reverse'

  const bar = (
    <Animated.View
      layout={LAYOUT}
      style={[
        styles.bar,
        {
          flexDirection: direction,
          alignSelf: side === 'left' ? 'flex-start' : 'flex-end',
          maxWidth: bodyWidth,
          padding: outset - 1,
          borderRadius: slotSize / 2 + outset,
          backgroundColor: neutral.surfaceDeep,
          borderColor: neutral.border,
        },
      ]}
    >
      {tabs.map((candidate) => (
        <BarTab
          key={candidate.id}
          tab={candidate}
          size={slotSize}
          direction={direction}
          active={candidate.id === tab.id}
          testID={testID ? `${testID}-tab-${candidate.id}` : undefined}
          onPress={() => onTabChange(candidate.id)}
        />
      ))}
    </Animated.View>
  )

  const view = (
    <View style={styles.view}>
      <Pressable style={styles.header} onPress={close} accessibilityRole="button">
        <IconComponent size={22} color={tab.color} weight="duotone" />
        <Text style={[styles.title, { color: neutral.textPrimary }]}>{tab.label}</Text>
      </Pressable>
      {children}
    </View>
  )

  return (
    <View style={[styles.stack, { width: bodyWidth }]}>
      {opensFromTop ? bar : view}
      {opensFromTop ? view : bar}
    </View>
  )
}

function BarTab({
  tab,
  size,
  direction,
  active,
  testID,
  onPress,
}: {
  tab: DrawerTab<string>
  size: number
  direction: 'row' | 'row-reverse'
  active: boolean
  testID?: string
  onPress: () => void
}) {
  const neutral = useResolvedNeutralColors()
  const color = useResolvedColor(tab.color)
  const IconComponent = tab.icon

  return (
    <Animated.View layout={LAYOUT}>
      <Pressable
        style={({ pressed }) => [
          styles.tab,
          { flexDirection: direction, height: size, minWidth: size, borderRadius: size / 2 },
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
        <View style={[styles.icon, { width: size - 2, height: size - 2 }]}>
          <IconComponent
            size={Math.round(size * 0.42)}
            color={active ? color : neutral.textMuted}
            weight={active ? 'duotone' : 'regular'}
          />
        </View>
        {active ? (
          <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(120)}>
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                { color, fontSize: size >= 48 ? 15 : 13 },
                direction === 'row' ? { paddingRight: size / 3 } : { paddingLeft: size / 3 },
              ]}
            >
              {tab.label}
            </Text>
          </Animated.View>
        ) : null}
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  stack: {
    gap: 12,
  },
  bar: {
    gap: 6,
    borderWidth: 1,
  },
  tab: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.alpha(theme.palette.mono.black, 0),
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontWeight: '700',
  },
  view: {
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    minHeight: 32,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
})
