import { CaretRightIcon, XIcon, type Icon } from 'phosphor-react-native'
import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View, type TextLayoutEvent } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { Text } from '@/components/base/Text'

import { interaction, theme } from '@/constants/theme'
import { useResolvedColor } from '@/hooks/useTheme'

interface FloatingBarFrameProps {
  bottomOffset?: number
  children: ReactNode
}

export interface FloatingStatusPillAction {
  kind: 'action'
  icon: Icon
  text: string
  bg: string
  border: string
  textColor: string
  buttonBg: string
  onPress: () => void
  testID?: string
}

export interface FloatingStatusPillSpinner {
  kind: 'spinner'
  icon?: Icon
  text: string
  color: string
  onPress: () => void
  testID?: string
  cancelTestID?: string
}

export type FloatingStatusPillModel = FloatingStatusPillAction | FloatingStatusPillSpinner

const STATUS_TRANSITION = { duration: 220, easing: Easing.out(Easing.cubic) } as const
const STATUS_MIN_WIDTH = 170
const STATUS_MAX_TEXT_WIDTH = 180
const SPINNER_FIXED_WIDTH = 88
const ACTION_FIXED_WIDTH = 78

interface FloatingActionPillProps {
  icon: Icon
  label: string
  onPress: () => void
  active?: boolean
  paused?: boolean
  disabled?: boolean
  testID?: string
}

export function FloatingBarFrame({ bottomOffset = 16, children }: FloatingBarFrameProps) {
  return (
    <View style={[styles.wrapper, { bottom: bottomOffset }]} pointerEvents="box-none">
      {children}
    </View>
  )
}

export function FloatingStatusPill({ pill }: { pill: FloatingStatusPillModel }) {
  const accent = pill.kind === 'spinner' ? pill.color : pill.buttonBg
  const resolvedAccent = useResolvedColor(accent)
  const resolvedShellBackground = useResolvedColor(
    pill.kind === 'spinner' ? theme.control.background : pill.bg,
  )
  const resolvedShellBorder = useResolvedColor(
    pill.kind === 'spinner' ? theme.alpha(pill.color, 0.3) : pill.border,
  )
  const resolvedIconBackground = useResolvedColor(theme.alpha(accent, 0.12))
  const resolvedIconBorder = useResolvedColor(theme.alpha(accent, 0.7))
  const shellBackground = useSharedValue(resolvedShellBackground)
  const shellBorder = useSharedValue(resolvedShellBorder)
  const iconBackground = useSharedValue(resolvedIconBackground)
  const iconBorder = useSharedValue(resolvedIconBorder)
  const shellWidth = useSharedValue(STATUS_MIN_WIDTH)
  const measuredTargetWidth = useRef(STATUS_MIN_WIDTH)

  useEffect(() => {
    shellBackground.value = withTiming(resolvedShellBackground, STATUS_TRANSITION)
    shellBorder.value = withTiming(resolvedShellBorder, STATUS_TRANSITION)
    iconBackground.value = withTiming(resolvedIconBackground, STATUS_TRANSITION)
    iconBorder.value = withTiming(resolvedIconBorder, STATUS_TRANSITION)
  }, [
    iconBackground,
    iconBorder,
    resolvedIconBackground,
    resolvedIconBorder,
    resolvedShellBackground,
    resolvedShellBorder,
    shellBackground,
    shellBorder,
  ])

  const shellColorStyle = useAnimatedStyle(() => ({
    backgroundColor: shellBackground.value,
    borderColor: shellBorder.value,
    width: shellWidth.value,
  }))
  const iconColorStyle = useAnimatedStyle(() => ({
    backgroundColor: iconBackground.value,
    borderColor: iconBorder.value,
  }))
  const handleTextLayout = useCallback(
    (event: TextLayoutEvent) => {
      const measuredWidth = Math.min(
        STATUS_MAX_TEXT_WIDTH,
        Math.ceil(event.nativeEvent.lines[0]?.width ?? 0),
      )
      const fixedWidth = pill.kind === 'spinner' ? SPINNER_FIXED_WIDTH : ACTION_FIXED_WIDTH
      const targetWidth = Math.max(STATUS_MIN_WIDTH, measuredWidth + fixedWidth)

      if (targetWidth === measuredTargetWidth.current) return

      measuredTargetWidth.current = targetWidth
      shellWidth.value = withTiming(targetWidth, STATUS_TRANSITION)
    },
    [pill.kind, shellWidth],
  )
  const StatusIcon = pill.icon
  const content =
    pill.kind === 'spinner' ? (
      <Pressable
        accessibilityLabel="Cancel"
        style={({ pressed }) => [styles.pillContent, pressed && styles.statusActionPressed]}
        android_ripple={interaction.ripple}
        onPress={pill.onPress}
        testID={pill.cancelTestID ?? pill.testID}
      >
        <Animated.View style={[styles.statusIcon, iconColorStyle]}>
          {StatusIcon ? (
            <StatusIcon size={17} color={resolvedAccent} weight="duotone" />
          ) : (
            <ActivityIndicator size="small" color={resolvedAccent} />
          )}
        </Animated.View>
        <Text style={[styles.pillText, { color: resolvedAccent }]} numberOfLines={1}>
          {pill.text}
        </Text>
        <View style={styles.cancelButton} pointerEvents="none">
          <XIcon size={18} color={resolvedAccent} weight="bold" />
        </View>
      </Pressable>
    ) : (
      <Pressable
        style={({ pressed }) => [
          styles.pillContent,
          styles.statusActionContent,
          pressed && styles.statusActionPressed,
        ]}
        android_ripple={interaction.ripple}
        onPress={pill.onPress}
        testID={pill.testID}
      >
        <Animated.View style={[styles.statusIcon, iconColorStyle]}>
          {StatusIcon ? <StatusIcon size={17} color={resolvedAccent} weight="duotone" /> : null}
        </Animated.View>
        <Text style={[styles.pillText, { color: pill.textColor }]} numberOfLines={1}>
          {pill.text}
        </Text>
        <View style={styles.actionChevron} pointerEvents="none">
          <CaretRightIcon size={16} color={resolvedAccent} weight="bold" />
        </View>
      </Pressable>
    )

  return (
    <View style={styles.pillHost}>
      <Text
        style={styles.textMeasure}
        numberOfLines={1}
        onTextLayout={handleTextLayout}
        pointerEvents="none"
      >
        {pill.text}
      </Text>
      <Animated.View style={[styles.pillShell, shellColorStyle]}>{content}</Animated.View>
    </View>
  )
}

export function FloatingActionPill({
  icon: IconComp,
  label,
  onPress,
  active = false,
  paused = false,
  disabled = false,
  testID,
}: FloatingActionPillProps) {
  // On a filled status surface the readable tone is the status `text` token, not `color`: the
  // surface is a pale tint on light, so a light foreground vanishes on it.
  const iconColor = paused
    ? theme.status.warning.text
    : active
      ? theme.status.error.text
      : theme.status.error.color
  return (
    <Pressable
      style={[
        styles.actionPill,
        active && styles.actionPillActive,
        paused && styles.actionPillPaused,
        disabled && styles.disabled,
      ]}
      android_ripple={interaction.ripple}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
    >
      <IconComp size={22} color={iconColor} weight="fill" />
      <Text
        style={[
          styles.actionPillText,
          active && styles.actionPillTextActive,
          paused && styles.actionPillTextPaused,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 30,
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
  },
  pillHost: {
    alignSelf: 'center',
    height: 38,
  },
  pillShell: {
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    overflow: 'hidden',
    backgroundColor: theme.control.background,
    borderColor: theme.control.border,
  },
  pillContent: {
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 4,
    paddingRight: 44,
  },
  pillText: {
    width: STATUS_MAX_TEXT_WIDTH,
    flexShrink: 0,
    fontSize: 12,
    fontWeight: '700',
  },
  textMeasure: {
    position: 'absolute',
    width: STATUS_MAX_TEXT_WIDTH,
    opacity: 0,
    fontSize: 12,
    fontWeight: '700',
  },
  statusActionContent: {
    paddingRight: 34,
  },
  statusActionPressed: {
    opacity: 0.72,
  },
  statusIcon: {
    width: 30,
    height: 30,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    borderWidth: 1,
  },
  cancelButton: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionChevron: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    paddingHorizontal: 18,
    borderRadius: 24,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.status.error.color,
    overflow: 'hidden',
    gap: 8,
  },
  actionPillActive: {
    backgroundColor: theme.status.error.bg,
    borderColor: theme.status.error.color,
  },
  actionPillPaused: {
    backgroundColor: theme.status.warning.bg,
    borderColor: theme.status.warning.color,
  },
  actionPillTextPaused: {
    color: theme.status.warning.text,
  },
  actionPillText: {
    color: theme.status.error.color,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  actionPillTextActive: {
    color: theme.status.error.text,
  },
  disabled: {
    opacity: 0.45,
  },
})
