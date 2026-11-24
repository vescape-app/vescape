import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useFocusTarget } from '@/components/base/focusScroll'
import { Text } from '@/components/base/Text'
import { CaretRightIcon } from 'phosphor-react-native'
import type { Icon, IconWeight } from 'phosphor-react-native'
import { SwitchAccentProvider } from '@/components/controls/Switch'
import { theme, type ThemeColor } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

export interface SettingsRowProps {
  icon: Icon
  iconColor?: ThemeColor
  iconWeight?: IconWeight
  label: string
  hint?: string
  focusId?: string
  onPress?: () => void
  right?: ReactNode
  children?: ReactNode
}

export function SettingsRow({
  icon: IconComponent,
  iconColor,
  iconWeight = 'duotone',
  label,
  hint,
  focusId,
  onPress,
  right,
  children,
}: SettingsRowProps) {
  const showChevron = onPress && !right
  const neutral = useResolvedNeutralColors()
  const resolvedIconColor = iconColor ?? neutral.textSecondary
  const { targetRef, onLayout, highlighted } = useFocusTarget(focusId)
  const highlightBg = highlighted ? { backgroundColor: neutral.surface } : null

  const content = (
    <View style={styles.row}>
      <View style={[styles.icon, { backgroundColor: neutral.surface }]}>
        <IconComponent size={20} color={resolvedIconColor} weight={iconWeight} />
      </View>
      <View style={styles.body}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      {right && iconColor ? (
        <SwitchAccentProvider accent={iconColor}>{right}</SwitchAccentProvider>
      ) : (
        right
      )}
      {showChevron ? <CaretRightIcon size={18} color={neutral.textMuted} weight="bold" /> : null}
    </View>
  )

  if (onPress) {
    return (
      <View ref={targetRef} onLayout={onLayout} collapsable={false}>
        <Pressable
          style={({ pressed }) => [
            styles.container,
            highlightBg,
            pressed && { backgroundColor: neutral.surface },
          ]}
          onPress={onPress}
        >
          {content}
          {children}
        </Pressable>
      </View>
    )
  }

  return (
    <View
      ref={targetRef}
      onLayout={onLayout}
      collapsable={false}
      style={[styles.container, highlightBg]}
    >
      {content}
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 2,
  },
  label: {
    color: theme.neutral.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  hint: {
    color: theme.neutral.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
})
