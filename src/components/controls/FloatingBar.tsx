import { CaretRightIcon, XIcon, type Icon } from 'phosphor-react-native'
import { useCallback, useState, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type TextLayoutEvent,
  type ViewStyle,
} from 'react-native'
import Animated, { type AnimatedStyle } from 'react-native-reanimated'
import { Text } from '@/components/base/Text'

import { interaction, theme, type ThemeColor } from '@/constants/theme'
import { useResolvedColor } from '@/hooks/useTheme'

interface FloatingBarFrameProps {
  bottomOffset?: number
  children: ReactNode
}

export interface FloatingStatusPillAction {
  kind: 'action'
  icon: Icon
  text: string
  bg: ThemeColor
  border: ThemeColor
  textColor: ThemeColor
  buttonBg: ThemeColor
  onPress: () => void
  testID?: string
}

export interface FloatingStatusPillSpinner {
  kind: 'spinner'
  icon?: Icon
  text: string
  color: ThemeColor
  onPress: () => void
  testID?: string
  cancelTestID?: string
}

export type FloatingStatusPillModel = FloatingStatusPillAction | FloatingStatusPillSpinner

const STATUS_TRANSITION = {
  transitionProperty: ['width', 'backgroundColor', 'borderColor'],
  transitionDuration: 220,
  transitionTimingFunction: 'ease-out',
} satisfies AnimatedStyle<ViewStyle>
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
  const shellBackground = useResolvedColor(
    pill.kind === 'spinner' ? theme.control.background : pill.bg,
  )
  const shellBorder = useResolvedColor(
    pill.kind === 'spinner' ? theme.alpha(pill.color, 0.3) : pill.border,
  )
  const iconBackground = useResolvedColor(theme.alpha(accent, 0.12))
  const iconBorder = useResolvedColor(theme.alpha(accent, 0.7))
  const [textWidth, setTextWidth] = useState(0)
  const handleTextLayout = useCallback((event: TextLayoutEvent) => {
    setTextWidth(Math.min(STATUS_MAX_TEXT_WIDTH, Math.ceil(event.nativeEvent.lines[0]?.width ?? 0)))
  }, [])
  const fixedWidth = pill.kind === 'spinner' ? SPINNER_FIXED_WIDTH : ACTION_FIXED_WIDTH
  const shellStyle = {
    width: Math.max(STATUS_MIN_WIDTH, textWidth + fixedWidth),
    backgroundColor: shellBackground,
    borderColor: shellBorder,
  }
  const iconStyle = { backgroundColor: iconBackground, borderColor: iconBorder }
  const StatusIcon = pill.icon
  const isSpinner = pill.kind === 'spinner'
  const content = (
    <Pressable
      accessibilityLabel={isSpinner ? 'Cancel' : undefined}
      style={({ pressed }) => [
        styles.pillContent,
        !isSpinner && styles.statusActionContent,
        pressed && styles.statusActionPressed,
      ]}
      android_ripple={interaction.ripple}
      onPress={pill.onPress}
      testID={isSpinner ? (pill.cancelTestID ?? pill.testID) : pill.testID}
    >
      <Animated.View style={{ ...styles.statusIcon, ...iconStyle, ...STATUS_TRANSITION }}>
        {StatusIcon ? (
          <StatusIcon size={17} color={resolvedAccent} weight="duotone" />
        ) : isSpinner ? (
          <ActivityIndicator size="small" color={resolvedAccent} />
        ) : null}
      </Animated.View>
      <Text
        style={[styles.pillText, { color: isSpinner ? resolvedAccent : pill.textColor }]}
        numberOfLines={1}
      >
        {pill.text}
      </Text>
      {isSpinner ? (
        <View style={styles.cancelButton} pointerEvents="none">
          <XIcon size={18} color={resolvedAccent} weight="bold" />
        </View>
      ) : (
        <View style={styles.actionChevron} pointerEvents="none">
          <CaretRightIcon size={16} color={resolvedAccent} weight="bold" />
        </View>
      )}
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
      <Animated.View style={{ ...styles.pillShell, ...shellStyle, ...STATUS_TRANSITION }}>
        {content}
      </Animated.View>
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
  const status = theme.status.error
  const filled = active || paused
  const accent = useResolvedColor(paused ? theme.control.border : status.color)
  const surface = useResolvedColor(paused ? theme.control.background : status.bg)
  const foreground = useResolvedColor(
    paused ? theme.control.textMuted : filled ? status.text : status.color,
  )

  return (
    <Pressable
      style={[
        styles.actionPill,
        { borderColor: accent },
        filled && { backgroundColor: surface },
        disabled && styles.disabled,
      ]}
      android_ripple={interaction.ripple}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
    >
      <IconComp size={22} color={foreground} weight="fill" />
      <Text style={[styles.actionPillText, { color: foreground }]}>{label}</Text>
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
    overflow: 'hidden',
    gap: 8,
  },
  actionPillText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  disabled: {
    opacity: 0.45,
  },
})
