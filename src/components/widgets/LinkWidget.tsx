import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { CaretRightIcon, type Icon } from 'phosphor-react-native'

import { secondaryWidgetSurface, type WidgetSize } from '@/components/widgets/widgetSurface'
import { theme } from '@/constants/theme'

interface LinkWidgetProps {
  icon: Icon
  label: string
  hint?: string
  accent?: string
  size?: WidgetSize
  disabled?: boolean
  onPress: () => void
}

/** A tappable widget that links somewhere — icon, label, hint and a chevron. */
export function LinkWidget({
  icon: IconComponent,
  label,
  hint,
  accent = theme.neutral.textMuted,
  size = 'full',
  disabled,
  onPress,
}: LinkWidgetProps) {
  const square = size === 'square'
  const iconSize = square ? 26 : size === 'half' ? 20 : 22

  return (
    <Pressable
      style={({ pressed }) => [
        styles.widget,
        square ? styles.widgetSquare : styles.widgetRow,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
      disabled={disabled}
      onPress={onPress}
      accessibilityLabel={label}
    >
      <IconComponent size={iconSize} color={accent} weight="duotone" />
      <View style={square ? styles.textSquare : styles.text}>
        <Text style={styles.label} numberOfLines={square ? 2 : 1}>
          {label}
        </Text>
        {hint && size === 'full' ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      {square ? null : <CaretRightIcon size={18} color={theme.neutral.textMuted} weight="bold" />}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  widget: {
    ...secondaryWidgetSurface,
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
  pressed: {
    backgroundColor: theme.neutral.surface,
  },
  disabled: {
    opacity: 0.45,
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  textSquare: {
    gap: 2,
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
})
