import { StyleSheet, Switch, View } from 'react-native'
import { Text } from '@/components/base/Text'
import type { Icon } from 'phosphor-react-native'

import { widgetSurface, type WidgetSize } from '@/components/widgets/widgetSurface'
import { theme } from '@/constants/theme'
import { useResolvedColor, useResolvedNeutralColors } from '@/hooks/useTheme'

interface SwitchWidgetProps {
  label: string
  value: boolean
  onValueChange: (value: boolean) => void
  icon?: Icon
  hint?: string
  /** Accent for the icon and the active track/thumb. */
  accent?: string
  size?: WidgetSize
  disabled?: boolean
  accessibilityLabel?: string
}

/** A labelled native switch on a widget surface — toggles a single boolean. */
export function SwitchWidget({
  label,
  value,
  onValueChange,
  icon: IconComponent,
  hint,
  accent = theme.palette.sky.color,
  size = 'full',
  disabled,
  accessibilityLabel,
}: SwitchWidgetProps) {
  const square = size === 'square'
  const neutral = useResolvedNeutralColors()
  const resolvedAccent = useResolvedColor(accent)

  const control = (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: neutral.border, true: theme.alpha(resolvedAccent, 0.6) }}
      thumbColor={value ? resolvedAccent : neutral.textMuted}
      ios_backgroundColor={neutral.border}
      accessibilityLabel={accessibilityLabel ?? label}
    />
  )

  if (square) {
    return (
      <View style={[styles.widget, styles.widgetSquare, disabled && styles.disabled]}>
        {IconComponent ? <IconComponent size={26} color={accent} weight="duotone" /> : null}
        <Text style={styles.label} numberOfLines={2}>
          {label}
        </Text>
        <View style={styles.squareControl}>{control}</View>
      </View>
    )
  }

  return (
    <View style={[styles.widget, styles.widgetRow, disabled && styles.disabled]}>
      {IconComponent ? <IconComponent size={22} color={accent} weight="duotone" /> : null}
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        {hint && size === 'full' ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      {control}
    </View>
  )
}

const styles = StyleSheet.create({
  widget: {
    ...widgetSurface,
  },
  widgetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
  },
  widgetSquare: {
    aspectRatio: 1,
    justifyContent: 'space-between',
    gap: 8,
    padding: 14,
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    color: theme.neutral.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  hint: {
    color: theme.neutral.textMuted,
    fontSize: 12,
  },
  squareControl: {
    alignItems: 'flex-start',
  },
})
