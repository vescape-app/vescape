import { createElement, type ReactNode, useCallback, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
import { XIcon, type Icon } from 'phosphor-react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

interface ActiveNavigationTopBarProps {
  boardPill: ReactNode
  maxWidth: number
  boardName: string
  connected: boolean
  targetTitle: string
  targetIcon: Icon
  distanceLabel: string
  riderColor: string
  onNavigationPress: () => void
  onCancel: () => void
}

function compactBoardName(name: string, availableWidth: number) {
  const maxChars = Math.floor(availableWidth / 7.5)
  if (maxChars < 3) return null
  if (name.length <= maxChars) return name
  return `${name.slice(0, Math.max(3, maxChars - 1))}…`
}

function CompactBoardPill({
  name,
  connected,
  availableWidth,
  onPress,
}: {
  name: string
  connected: boolean
  availableWidth: number
  onPress: () => void
}) {
  const label = compactBoardName(name, availableWidth)
  return (
    <View style={[styles.boardPill, !label && styles.boardPillDotOnly]}>
      <Pressable accessibilityLabel="Board selector" onPress={onPress} style={styles.boardIdentity}>
        <View
          style={[
            styles.statusDot,
            {
              backgroundColor: connected ? theme.palette.green.color : theme.control.textMuted,
            },
          ]}
        />
        {label ? (
          <Text numberOfLines={1} style={styles.boardName}>
            {label}
          </Text>
        ) : null}
      </Pressable>
    </View>
  )
}

function TargetIcon({ icon, color, size = 16 }: { icon: Icon; color: string; size?: number }) {
  return createElement(icon, { size, color, weight: 'bold' })
}

function CancelButton({ color, onPress }: { color: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel="Cancel navigation"
      onPress={(event) => {
        event.stopPropagation()
        onPress()
      }}
      style={styles.cancel}
    >
      <XIcon size={22} color={color} weight="bold" />
    </Pressable>
  )
}

export function ActiveNavigationTopBar({
  boardPill,
  maxWidth,
  boardName,
  connected,
  targetTitle,
  targetIcon,
  distanceLabel,
  riderColor,
  onNavigationPress,
  onCancel,
}: ActiveNavigationTopBarProps) {
  const { width } = useWindowDimensions()
  const neutral = useResolvedNeutralColors()
  const [navigationPrimary, setNavigationPrimary] = useState(true)
  const navigationPrimaryRef = useRef(true)
  const gestureTriggeredRef = useRef(false)
  const swapProgress = useSharedValue(1)
  const boardTextWidth = Math.max(0, width - 300)
  const targetTint = theme.alpha(riderColor, 0.12)
  const targetBorder = theme.alpha(riderColor, 0.7)
  const targetPillWidth = Math.min(176, maxWidth)

  const navigationSwapStyle = useAnimatedStyle(() => ({
    opacity: interpolate(swapProgress.value, [0, 1], [0.78, 1]),
    zIndex: swapProgress.value > 0.5 ? 1 : 2,
    transform: [
      { translateY: interpolate(swapProgress.value, [0, 1], [29, 0]) },
      { scale: interpolate(swapProgress.value, [0, 1], [0.76, 1]) },
    ],
  }))
  const boardSwapStyle = useAnimatedStyle(() => ({
    opacity: interpolate(swapProgress.value, [0, 1], [1, 0.78]),
    zIndex: swapProgress.value > 0.5 ? 2 : 1,
    transform: [
      { translateY: interpolate(swapProgress.value, [0, 1], [0, 29]) },
      { scale: interpolate(swapProgress.value, [0, 1], [1, 0.76]) },
    ],
  }))

  const swapPrimary = useCallback(
    (nextNavigationPrimary: boolean) => {
      navigationPrimaryRef.current = nextNavigationPrimary
      setNavigationPrimary(nextNavigationPrimary)
      swapProgress.value = withSpring(nextNavigationPrimary ? 1 : 0, {
        damping: 17,
        stiffness: 210,
        mass: 0.72,
      })
    },
    [swapProgress],
  )
  const swapGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-8, 8])
        .failOffsetX([-18, 18])
        .runOnJS(true)
        .onBegin(() => {
          gestureTriggeredRef.current = false
        })
        .onUpdate((event) => {
          if (gestureTriggeredRef.current || Math.abs(event.translationY) < 12) return
          gestureTriggeredRef.current = true
          swapPrimary(!navigationPrimaryRef.current)
        })
        .onFinalize(() => {
          gestureTriggeredRef.current = false
        }),
    [swapPrimary],
  )

  return (
    <GestureDetector gesture={swapGesture}>
      <View style={styles.stack}>
        <Animated.View pointerEvents="auto" style={[styles.swapItem, navigationSwapStyle]}>
          {navigationPrimary ? (
            <Pressable
              accessibilityLabel={`Navigation target: ${targetTitle}`}
              onPress={onNavigationPress}
              style={[
                styles.targetPill,
                {
                  width: targetPillWidth,
                  borderColor: targetBorder,
                  backgroundColor: neutral.surfaceDeep,
                },
              ]}
            >
              <View
                style={[
                  styles.targetIcon,
                  {
                    borderColor: targetBorder,
                    backgroundColor: neutral.surface,
                  },
                ]}
              >
                <TargetIcon icon={targetIcon} color={riderColor} />
              </View>
              <View style={styles.targetCopy}>
                <Text
                  numberOfLines={1}
                  style={[styles.targetTitle, { color: theme.neutral.textPrimary }]}
                >
                  {targetTitle}
                </Text>
                <Text style={[styles.distance, { color: riderColor }]}>{distanceLabel}</Text>
              </View>
              <CancelButton color={riderColor} onPress={onCancel} />
            </Pressable>
          ) : (
            <Pressable
              accessibilityLabel="Show navigation target"
              onPress={() => swapPrimary(true)}
              style={[
                styles.navigationMini,
                { borderColor: targetBorder, backgroundColor: targetTint },
              ]}
            >
              <TargetIcon icon={targetIcon} color={riderColor} size={12} />
              <Text style={[styles.navigationMiniDistance, { color: riderColor }]}>
                {distanceLabel}
              </Text>
            </Pressable>
          )}
        </Animated.View>
        <Animated.View pointerEvents="auto" style={[styles.swapItem, boardSwapStyle]}>
          {navigationPrimary ? (
            <CompactBoardPill
              name={boardName}
              connected={connected}
              availableWidth={boardTextWidth}
              onPress={() => swapPrimary(false)}
            />
          ) : (
            boardPill
          )}
        </Animated.View>
      </View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  stack: {
    width: 220,
    height: 57,
    alignItems: 'center',
  },
  swapItem: {
    position: 'absolute',
    top: 0,
    alignItems: 'center',
  },
  boardPill: {
    minWidth: 28,
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.control.border,
    backgroundColor: theme.neutral.surfaceDeep,
  },
  boardPillDotOnly: {
    width: 28,
    paddingHorizontal: 0,
  },
  boardIdentity: {
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 8,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  boardName: {
    maxWidth: 52,
    color: theme.neutral.textMuted,
    fontSize: 10,
    fontWeight: '800',
  },
  targetPill: {
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 19,
    borderWidth: 1,
    paddingLeft: 4,
  },
  targetIcon: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    borderWidth: 1,
    backgroundColor: theme.control.backgroundPressed,
  },
  targetCopy: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    paddingLeft: 8,
    paddingRight: 0,
  },
  targetTitle: {
    fontSize: 10,
    fontWeight: '800',
  },
  distance: {
    marginTop: -1,
    fontSize: 9,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  cancel: {
    width: 38,
    height: 38,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navigationMini: {
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    borderRadius: 14,
    borderWidth: 1,
  },
  navigationMiniDistance: {
    fontSize: 10,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
})
