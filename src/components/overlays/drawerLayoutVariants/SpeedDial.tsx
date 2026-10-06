/** PROTOTYPE variant — labelled FAB speed dial over the trigger, open view full width above (below from top). */
import { Pressable, StyleSheet, View } from 'react-native'
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated'

import { Text } from '@/components/base/Text'
import type { DrawerLayoutVariantProps } from '@/components/overlays/drawerLayoutVariants/types'
import type { DrawerTab } from '@/components/overlays/TabbedEdgeDrawer'
import { theme } from '@/constants/theme'
import { useResolvedColor, useResolvedNeutralColors } from '@/hooks/useTheme'

const STAGGER_MS = 40
const ITEM_MS = 140

export function SpeedDial({
  tabs,
  activeTab,
  onTabChange,
  testID,
  slotSize,
  outset,
  side,
  opensFromTop,
  close,
  children,
}: DrawerLayoutVariantProps) {
  const neutral = useResolvedNeutralColors()
  const tab = tabs.find((candidate) => candidate.id === activeTab) ?? tabs[0]
  const IconComponent = tab.icon
  const Entering = opensFromTop ? FadeInUp : FadeInDown

  const view = (
    <View style={styles.view}>
      <Pressable style={styles.header} onPress={close} accessibilityRole="button">
        <IconComponent size={28} color={tab.color} weight="duotone" />
        <Text style={[styles.title, { color: neutral.textPrimary }]}>{tab.label}</Text>
      </Pressable>
      {children}
    </View>
  )

  const dial = (
    <View
      style={[
        styles.dial,
        {
          alignItems: side === 'left' ? 'flex-start' : 'flex-end',
          [side === 'left' ? 'paddingLeft' : 'paddingRight']: outset,
          [opensFromTop ? 'paddingTop' : 'paddingBottom']: outset,
        },
      ]}
    >
      {tabs.map((candidate, index) => {
        // Items unfold outward from the trigger: the slot over the trigger lands first.
        const distance = opensFromTop ? index : tabs.length - 1 - index
        return (
          <Animated.View
            key={candidate.id}
            entering={Entering.delay(distance * STAGGER_MS).duration(ITEM_MS)}
          >
            <DialItem
              tab={candidate}
              size={slotSize}
              side={side}
              active={candidate.id === tab.id}
              testID={testID ? `${testID}-tab-${candidate.id}` : undefined}
              onPress={() => onTabChange(candidate.id)}
            />
          </Animated.View>
        )
      })}
    </View>
  )

  return (
    <View style={styles.root}>
      {opensFromTop ? dial : view}
      {opensFromTop ? view : dial}
    </View>
  )
}

function DialItem({
  tab,
  size,
  side,
  active,
  testID,
  onPress,
}: {
  tab: DrawerTab<string>
  size: number
  side: 'left' | 'right'
  active: boolean
  testID?: string
  onPress: () => void
}) {
  const neutral = useResolvedNeutralColors()
  const color = useResolvedColor(tab.color)
  const IconComponent = tab.icon
  const activeFill = {
    backgroundColor: theme.alpha(color, 0.12),
    borderColor: theme.alpha(color, 0.6),
  }
  const idleFill = { backgroundColor: neutral.surfaceDeep, borderColor: neutral.border }

  return (
    <Pressable
      style={({ pressed }) => [
        styles.item,
        { flexDirection: side === 'left' ? 'row' : 'row-reverse' },
        pressed && !active && styles.pressed,
      ]}
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: active }}
      testID={testID}
      onPress={onPress}
    >
      <View
        style={[
          styles.circle,
          { width: size, height: size, borderRadius: size / 2 },
          active ? activeFill : idleFill,
        ]}
      >
        <IconComponent
          size={Math.round(size * 0.42)}
          color={active ? color : neutral.textMuted}
          weight={active ? 'duotone' : 'regular'}
        />
      </View>
      <View style={[styles.chip, active ? activeFill : idleFill]}>
        <Text style={[styles.chipLabel, { color: active ? color : neutral.textMuted }]}>
          {tab.label}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: {
    gap: 16,
  },
  view: {
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 4,
    minHeight: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
  },
  dial: {
    gap: 12,
  },
  item: {
    alignItems: 'center',
    gap: 10,
  },
  pressed: {
    opacity: 0.7,
  },
  circle: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
})
