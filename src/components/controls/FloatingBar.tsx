import { XIcon, type Icon } from 'phosphor-react-native'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'

import { interaction, theme } from '@/constants/theme'

interface FloatingBarFrameProps {
  bottomOffset?: number
  children: ReactNode
}

export interface FloatingStatusPillAction {
  kind: 'action'
  icon: Icon
  text: string
  buttonText: string
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
  if (pill.kind === 'spinner') {
    const StatusIcon = pill.icon
    return (
      <View style={[styles.pill, { borderColor: `${pill.color}55` }]} testID={pill.testID}>
        <View
          style={[
            styles.statusIcon,
            {
              backgroundColor: theme.alpha(pill.color, 0.12),
              borderColor: theme.alpha(pill.color, 0.7),
            },
          ]}
        >
          {StatusIcon ? (
            <StatusIcon size={17} color={pill.color} weight="duotone" />
          ) : (
            <ActivityIndicator size="small" color={pill.color} />
          )}
        </View>
        <Text style={[styles.pillText, { color: pill.color }]} numberOfLines={1}>
          {pill.text}
        </Text>
        <Pressable
          accessibilityLabel="Cancel"
          style={styles.cancelButton}
          android_ripple={interaction.ripple}
          onPress={pill.onPress}
          testID={pill.cancelTestID}
        >
          <XIcon size={18} color={pill.color} weight="bold" />
        </Pressable>
      </View>
    )
  }

  const StatusIcon = pill.icon

  return (
    <Pressable
      style={[styles.pill, { backgroundColor: pill.bg, borderColor: pill.border }]}
      android_ripple={interaction.ripple}
      onPress={pill.onPress}
      testID={pill.testID}
    >
      <View
        style={[
          styles.statusIcon,
          {
            backgroundColor: theme.alpha(pill.buttonBg, 0.12),
            borderColor: theme.alpha(pill.buttonBg, 0.7),
          },
        ]}
      >
        <StatusIcon size={17} color={pill.buttonBg} weight="duotone" />
      </View>
      <Text style={[styles.pillText, { color: pill.textColor }]} numberOfLines={1}>
        {pill.text}
      </Text>
      <View
        style={[
          styles.pillButton,
          {
            backgroundColor: theme.alpha(pill.buttonBg, 0.12),
            borderColor: theme.alpha(pill.buttonBg, 0.7),
          },
        ]}
      >
        <Text style={[styles.pillButtonText, { color: pill.buttonBg }]}>{pill.buttonText}</Text>
      </View>
    </Pressable>
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
  const iconColor = paused
    ? theme.status.warning.color
    : active
      ? theme.control.text
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
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 38,
    paddingLeft: 4,
    paddingRight: 4,
    borderRadius: 19,
    borderWidth: 1,
    overflow: 'hidden',
    gap: 8,
    backgroundColor: theme.control.background,
    borderColor: theme.control.border,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '700',
    maxWidth: 180,
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
  pillButton: {
    height: 30,
    paddingHorizontal: 14,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillButtonText: {
    fontSize: 12,
    fontWeight: '800',
  },
  cancelButton: {
    width: 30,
    height: 30,
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
    color: theme.status.warning.color,
  },
  actionPillText: {
    color: theme.status.error.color,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  actionPillTextActive: {
    color: theme.control.text,
  },
  disabled: {
    opacity: 0.45,
  },
})
