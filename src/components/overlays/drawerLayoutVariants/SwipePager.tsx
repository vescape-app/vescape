/** PROTOTYPE variant — big card swiped sideways between tabs, big header + progress strip, dot row ending on the trigger. */
import { useEffect, useRef } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { FadeIn, SlideInLeft, SlideInRight } from 'react-native-reanimated'

import { Text } from '@/components/base/Text'
import type { DrawerTab } from '@/components/overlays/TabbedEdgeDrawer'
import type { DrawerLayoutVariantProps } from '@/components/overlays/drawerLayoutVariants/types'
import { theme } from '@/constants/theme'
import { useResolvedColor, useResolvedNeutralColors } from '@/hooks/useTheme'

const SWIPE_THRESHOLD = 60
const SWIPE_VELOCITY = 600
const DOT_SCALE = 0.6

export function SwipePager({
  tabs,
  activeTab,
  onTabChange,
  testID,
  slotSize,
  outset,
  side,
  opensFromTop,
  bodyWidth,
  children,
}: DrawerLayoutVariantProps) {
  const neutral = useResolvedNeutralColors()
  const index = Math.max(
    0,
    tabs.findIndex((candidate) => candidate.id === activeTab),
  )
  const tab = tabs[index]
  const color = useResolvedColor(tab.color)
  const IconComponent = tab.icon
  const direction = side === 'left' ? 'row' : 'row-reverse'
  // Tabs run away from the trigger: rightwards on the left edge, leftwards on the right edge.
  const screenStep = side === 'left' ? 1 : -1

  const previousIndex = useRef(index)
  const enteringFromRight = (index - previousIndex.current) * screenStep >= 0
  useEffect(() => {
    previousIndex.current = index
  }, [index])

  const goTo = (target: number) => {
    const next = tabs[target]
    if (next) onTabChange(next.id)
  }

  const swipe = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-15, 15])
    .failOffsetY([-12, 12])
    .onEnd(({ translationX, velocityX }) => {
      const passed =
        Math.abs(translationX) > SWIPE_THRESHOLD || Math.abs(velocityX) > SWIPE_VELOCITY
      if (!passed) return
      // Swiping left reveals the tab sitting to the right on screen.
      goTo(index + (translationX < 0 ? screenStep : -screenStep))
    })

  const entering = (enteringFromRight ? SlideInRight : SlideInLeft).duration(240)

  const card = (
    <GestureDetector gesture={swipe}>
      <View
        style={[styles.card, { backgroundColor: neutral.surface, borderColor: neutral.border }]}
      >
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <IconComponent size={28} color={color} weight="duotone" />
            <Text style={[styles.title, { color: neutral.textPrimary }]} numberOfLines={1}>
              {tab.label}
            </Text>
          </View>
          <View style={[styles.progress, { flexDirection: direction }]}>
            {tabs.map((candidate, candidateIndex) => (
              <View
                key={candidate.id}
                style={[
                  styles.segment,
                  {
                    backgroundColor:
                      candidateIndex === index ? color : theme.alpha(neutral.textMuted, 0.3),
                  },
                ]}
              />
            ))}
          </View>
        </View>
        <Animated.View key={tab.id} entering={entering}>
          <Animated.View entering={FadeIn.duration(240)}>{children}</Animated.View>
        </Animated.View>
      </View>
    </GestureDetector>
  )

  const row = (
    <View
      style={[
        styles.row,
        {
          flexDirection: direction,
          paddingHorizontal: outset,
          [opensFromTop ? 'paddingTop' : 'paddingBottom']: outset,
        },
      ]}
    >
      {tabs.map((candidate, candidateIndex) => (
        <PagerDot
          key={candidate.id}
          tab={candidate}
          size={slotSize}
          active={candidateIndex === index}
          testID={testID ? `${testID}-tab-${candidate.id}` : undefined}
          onPress={() => onTabChange(candidate.id)}
        />
      ))}
    </View>
  )

  return (
    <View style={[styles.stack, { width: bodyWidth }]}>
      {opensFromTop ? row : card}
      {opensFromTop ? card : row}
    </View>
  )
}

function PagerDot({
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
  const diameter = active ? size : Math.round(size * DOT_SCALE)

  // Each tab owns a fixed trigger-sized slot, so only the circle inside it changes size.
  return (
    <Pressable
      style={[styles.slot, { width: size, height: size }]}
      hitSlop={4}
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: active }}
      testID={testID}
      onPress={onPress}
    >
      <View
        style={[
          styles.dot,
          {
            width: diameter,
            height: diameter,
            borderRadius: diameter / 2,
            backgroundColor: active ? color : neutral.surfaceDeep,
            borderColor: active ? color : neutral.border,
          },
        ]}
      >
        <IconComponent
          size={Math.round(diameter * 0.45)}
          color={active ? neutral.surfaceDeep : neutral.textMuted}
          weight={active ? 'fill' : 'regular'}
        />
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  stack: {
    gap: 10,
  },
  card: {
    borderRadius: 28,
    borderWidth: 1,
    padding: 16,
    gap: 14,
    overflow: 'hidden',
  },
  header: {
    gap: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    flexShrink: 1,
    fontSize: 26,
    fontWeight: '800',
  },
  progress: {
    gap: 4,
  },
  segment: {
    flex: 1,
    height: 3,
    borderRadius: 2,
  },
  row: {
    gap: 6,
    alignItems: 'center',
  },
  slot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
