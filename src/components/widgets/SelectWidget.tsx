import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { CaretDownIcon, type Icon } from 'phosphor-react-native'

import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { theme } from '@/constants/theme'

interface SelectWidgetProps {
  icon: Icon
  selectIcon?: Icon
  /** Status marker shown next to the value pill — an icon alone, no label, no press target. */
  badgeIcon?: Icon
  badgeAccent?: string
  label: string
  value: string
  description?: string
  accent?: string
  selectAccent?: string
  selectBackground?: string
  selectBorder?: string
  selectOpen?: boolean
  disabled?: boolean
  showSelect?: boolean
  onPress: () => void
  onSelectPress?: () => void
}

/** A compact 1×4 select-like widget: title + description with a current value pill. */
export function SelectWidget({
  icon: IconComponent,
  selectIcon: SelectIconComponent,
  badgeIcon: BadgeIconComponent,
  badgeAccent = theme.control.textMuted,
  label,
  value,
  description,
  accent = theme.control.textMuted,
  selectAccent,
  selectBackground,
  selectBorder,
  selectOpen = false,
  disabled,
  showSelect = true,
  onPress,
  onSelectPress,
}: SelectWidgetProps) {
  const surface = useResolvedSecondaryWidgetSurface()
  const selectTextColor = selectAccent ?? theme.control.text
  const selectControlColor = selectAccent ?? theme.control.textMuted
  const valuePillStyle =
    selectBackground || selectBorder
      ? {
          backgroundColor: selectBackground ?? theme.control.backgroundPressed,
          borderColor: selectBorder ?? selectAccent ?? theme.control.divider,
        }
      : null

  return (
    <Pressable
      style={({ pressed }) => [
        surface,
        styles.widget,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
    >
      <IconComponent size={22} color={accent} weight="duotone" />
      <View style={styles.body}>
        <View style={styles.textColumn}>
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
          {description ? (
            <Text style={styles.description} numberOfLines={2}>
              {description}
            </Text>
          ) : null}
        </View>
        {BadgeIconComponent ? (
          <BadgeIconComponent size={20} color={badgeAccent} weight="duotone" />
        ) : null}
        {showSelect ? (
          <Pressable
            style={[styles.valuePill, valuePillStyle]}
            disabled={disabled || !onSelectPress}
            onPress={(event) => {
              event.stopPropagation()
              onSelectPress?.()
            }}
            accessibilityRole="button"
            accessibilityLabel={`${label} options`}
          >
            {SelectIconComponent ? (
              <SelectIconComponent size={17} color={selectControlColor} weight="duotone" />
            ) : null}
            <Text style={[styles.value, { color: selectTextColor }]} numberOfLines={1}>
              {value}
            </Text>
            <View style={[styles.caret, selectOpen && styles.caretOpen]}>
              <CaretDownIcon size={15} color={selectControlColor} weight="bold" />
            </View>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  widget: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
  },
  pressed: {
    backgroundColor: theme.neutral.surface,
  },
  disabled: {
    opacity: 0.5,
  },
  body: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  label: {
    color: theme.neutral.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  valuePill: {
    maxWidth: '48%',
    minHeight: 36,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.control.divider,
    backgroundColor: theme.control.backgroundPressed,
  },
  value: {
    flexShrink: 1,
    color: theme.control.text,
    fontSize: 14,
    fontWeight: '700',
  },
  caret: {
    transform: [{ rotate: '0deg' }],
  },
  caretOpen: {
    transform: [{ rotate: '180deg' }],
  },
  description: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
})
