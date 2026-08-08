import { createElement, useCallback, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
import { CaretDownIcon, PowerIcon, XIcon } from 'phosphor-react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { BoardWarningControl } from '@/modules/board/components/BoardWarningControl'
import type { MapPinKind } from '@/modules/map-points/constants/mapPoints'
import { getMapPointKindIcon } from '@/modules/map-points/constants/mapPointIcons'

interface ActiveNavigationTopBarProps {
  boardName: string
  connected: boolean
  targetTitle: string
  targetKind: MapPinKind
  distanceLabel: string
  riderColor: string
  activeBoardId: string | null
  canDisconnect: boolean
  onBoardPress: () => void
  onDisconnect: () => void
  onCancel: () => void
}

function BoardActions({
  activeBoardId,
  canDisconnect,
  onDisconnect,
}: {
  activeBoardId: string | null
  canDisconnect: boolean
  onDisconnect: () => void
}) {
  return (
    <>
      {canDisconnect ? (
        <>
          <View style={styles.divider} />
          <Pressable
            accessibilityLabel="Disconnect board"
            onPress={onDisconnect}
            style={styles.boardAction}
            testID="board-disconnect-button"
          >
            <PowerIcon size={15} color={theme.status.error.color} weight="bold" />
          </Pressable>
        </>
      ) : null}
      {activeBoardId ? <BoardWarningControl boardId={activeBoardId} /> : null}
    </>
  )
}

function compactBoardName(name: string, availableWidth: number) {
  const maxChars = Math.floor(availableWidth / 7.5)
  if (maxChars < 3) return null
  if (name.length <= maxChars) return name
  return `${name.slice(0, Math.max(3, maxChars - 1))}…`
}

function NavigationBoardPill({
  name,
  connected,
  availableWidth,
  expanded,
  activeBoardId,
  canDisconnect,
  onPress,
  onDisconnect,
}: {
  name: string
  connected: boolean
  availableWidth: number
  expanded: boolean
  activeBoardId: string | null
  canDisconnect: boolean
  onPress: () => void
  onDisconnect: () => void
}) {
  const label = expanded ? name : compactBoardName(name, availableWidth)
  return (
    <View
      style={[
        styles.boardPill,
        expanded && styles.boardPillExpanded,
        !label && styles.boardPillDotOnly,
      ]}
    >
      <Pressable accessibilityLabel="Board selector" onPress={onPress} style={styles.boardIdentity}>
        <View
          style={[
            styles.statusDot,
            {
              backgroundColor: connected
                ? theme.palette.green.color
                : theme.palette.slate.textMuted,
            },
          ]}
        />
        {label ? (
          <Text numberOfLines={1} style={[styles.boardName, expanded && styles.boardNameExpanded]}>
            {label}
          </Text>
        ) : null}
        {expanded ? (
          <CaretDownIcon size={11} color={theme.palette.slate.textMuted} weight="bold" />
        ) : null}
      </Pressable>
      {expanded ? (
        <BoardActions
          activeBoardId={activeBoardId}
          canDisconnect={canDisconnect}
          onDisconnect={onDisconnect}
        />
      ) : null}
    </View>
  )
}

function TargetIcon({
  kind,
  color,
  size = 16,
}: {
  kind: MapPinKind
  color: string
  size?: number
}) {
  return createElement(getMapPointKindIcon(kind), { size, color, weight: 'bold' })
}

function CancelButton({ color, onPress }: { color: string; onPress: () => void }) {
  return (
    <Pressable accessibilityLabel="Cancel navigation" onPress={onPress} style={styles.cancel}>
      <XIcon size={12} color={color} weight="bold" />
    </Pressable>
  )
}

export function ActiveNavigationTopBar({
  boardName,
  connected,
  targetTitle,
  targetKind,
  distanceLabel,
  riderColor,
  activeBoardId,
  canDisconnect,
  onBoardPress,
  onDisconnect,
  onCancel,
}: ActiveNavigationTopBarProps) {
  const { width } = useWindowDimensions()
  const [navigationPrimary, setNavigationPrimary] = useState(true)
  const navigationPrimaryRef = useRef(true)
  const gestureTriggeredRef = useRef(false)
  const swapProgress = useSharedValue(1)
  const boardTextWidth = Math.max(0, width - 300)
  const targetTint = theme.alpha(riderColor, 0.12)
  const targetBorder = theme.alpha(riderColor, 0.7)

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
            <View
              accessibilityLabel={`Navigation target: ${targetTitle}`}
              style={[
                styles.targetPill,
                { borderColor: targetBorder, backgroundColor: targetTint },
              ]}
            >
              <View style={[styles.targetIcon, { borderColor: targetBorder }]}>
                <TargetIcon kind={targetKind} color={riderColor} />
              </View>
              <View style={styles.targetCopy}>
                <Text numberOfLines={1} style={styles.targetTitle}>
                  {targetTitle}
                </Text>
                <Text style={[styles.distance, { color: riderColor }]}>{distanceLabel}</Text>
              </View>
              <BoardActions
                activeBoardId={activeBoardId}
                canDisconnect={canDisconnect}
                onDisconnect={onDisconnect}
              />
              <CancelButton color={riderColor} onPress={onCancel} />
            </View>
          ) : (
            <Pressable
              accessibilityLabel="Show navigation target"
              onPress={() => swapPrimary(true)}
              style={[
                styles.navigationMini,
                { borderColor: targetBorder, backgroundColor: targetTint },
              ]}
            >
              <TargetIcon kind={targetKind} color={riderColor} size={12} />
              <Text style={[styles.navigationMiniDistance, { color: riderColor }]}>
                {distanceLabel}
              </Text>
            </Pressable>
          )}
        </Animated.View>
        <Animated.View pointerEvents="auto" style={[styles.swapItem, boardSwapStyle]}>
          <NavigationBoardPill
            name={boardName}
            connected={connected}
            availableWidth={navigationPrimary ? boardTextWidth : 130}
            expanded={!navigationPrimary}
            activeBoardId={activeBoardId}
            canDisconnect={canDisconnect}
            onPress={() => {
              if (navigationPrimary) {
                swapPrimary(false)
                return
              }
              onBoardPress()
            }}
            onDisconnect={onDisconnect}
          />
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
    top: 9.5,
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
    borderColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
  boardPillDotOnly: {
    width: 28,
    paddingHorizontal: 0,
  },
  boardPillExpanded: {
    height: 38,
    minWidth: 112,
    maxWidth: 190,
    borderRadius: 19,
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
    color: theme.palette.slate.textSecondary,
    fontSize: 10,
    fontWeight: '800',
  },
  boardNameExpanded: {
    maxWidth: 128,
    color: theme.palette.slate.textPrimary,
    fontSize: 13,
  },
  targetPill: {
    height: 38,
    minWidth: 166,
    maxWidth: 280,
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
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
  targetCopy: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 8,
  },
  targetTitle: {
    color: theme.palette.slate.textPrimary,
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
    width: 30,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    width: 1,
    height: 20,
    backgroundColor: theme.palette.slate.border,
  },
  boardAction: {
    width: 32,
    height: 38,
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
