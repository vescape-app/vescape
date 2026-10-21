import { StyleSheet, View } from 'react-native'
import { Switch } from '@/components/controls/Switch'
import { Text } from '@/components/base/Text'
import type { Icon } from 'phosphor-react-native'

import {
  useResolvedSecondaryWidgetSurface,
  type WidgetSize,
} from '@/components/widgets/widgetSurface'
import { theme, type ThemeColor } from '@/constants/theme'

interface SwitchWidgetProps {
  label: string
  value: boolean
  onValueChange: (value: boolean) => void
  icon?: Icon
  hint?: string
  /** Accent for the icon and the switch's on state. */
  accent?: ThemeColor
  size?: WidgetSize
  disabled?: boolean
  accessibilityLabel?: string
}

/** A labelled switch on a widget surface — toggles a single boolean. */
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
  const surface = useResolvedSecondaryWidgetSurface()

  const control = (
    <Switch
      value={value}
      onValueChange={onValueChange}
      {...(disabled ? { disabled } : {})}
      accent={accent}
      accessibilityLabel={accessibilityLabel ?? label}
    />
  )

  if (square) {
    return (
      <View style={[surface, styles.widgetSquare, disabled && styles.disabled]}>
        {IconComponent ? <IconComponent size={26} color={accent} weight="duotone" /> : null}
        <Text style={styles.label} numberOfLines={2}>
          {label}
        </Text>
        <View style={styles.squareControl}>{control}</View>
      </View>
    )
  }

  return (
    <View style={[surface, styles.widgetRow, disabled && styles.disabled]}>
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
    color: theme.neutral.textSecondary,
    fontSize: 12,
  },
  squareControl: {
    alignItems: 'flex-start',
  },
})
