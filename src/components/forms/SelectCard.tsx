import { useCallback, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { CaretDownIcon, CheckIcon, type Icon as PhosphorIcon } from 'phosphor-react-native'

import { interaction, theme } from '@/constants/theme'
import { Dropdown } from '@/components/forms/Dropdown'
import type { SelectOption } from '@/components/forms/Select'
import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'

const MAX_DROPDOWN_HEIGHT = 280

interface SelectCardProps<T extends string = string> {
  icon: PhosphorIcon
  iconColor: string
  title: string
  description?: string
  options: SelectOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Rendered below the trigger row, inside the card (e.g. custom dials). */
  children?: React.ReactNode
  style?: ViewStyle
}

export function SelectCard<T extends string = string>({
  icon: Icon,
  iconColor,
  title,
  description,
  options,
  value,
  onChange,
  children,
  style,
}: SelectCardProps<T>) {
  const triggerRef = useRef<View>(null)
  const [open, setOpen] = useState(false)

  const selectedOption = options.find((o) => o.value === value)

  const surface = useResolvedSecondaryWidgetSurface()
  const handleSelect = useCallback(
    (optionValue: T) => {
      onChange(optionValue)
      setOpen(false)
    },
    [onChange],
  )

  return (
    <View style={[surface, styles.container, style]}>
      <Pressable
        ref={triggerRef}
        style={({ pressed }) => [
          styles.trigger,
          pressed && { opacity: interaction.pressedOpacity },
        ]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
      >
        <View style={styles.titleRow}>
          <Icon size={16} color={iconColor} weight="duotone" />
          <View>
            <Text style={styles.title}>{title}</Text>
            {description ? <Text style={styles.description}>{description}</Text> : null}
          </View>
        </View>
        <View style={styles.valueRow}>
          <Text
            style={[styles.valueText, !selectedOption && styles.placeholderText]}
            numberOfLines={1}
          >
            {selectedOption?.label ?? 'Select…'}
          </Text>
          <CaretDownIcon size={16} color={theme.neutral.textMuted} weight="bold" />
        </View>
      </Pressable>
      {children}
      <Dropdown
        visible={open}
        triggerRef={triggerRef}
        onClose={() => setOpen(false)}
        maxHeight={MAX_DROPDOWN_HEIGHT}
      >
        <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
          {options.map((option, index) => {
            const selected = option.value === value
            return (
              <Pressable
                key={option.value}
                style={({ pressed }) => [
                  styles.option,
                  index < options.length - 1 && styles.optionBorder,
                  selected && styles.optionSelected,
                  pressed && styles.optionPressed,
                ]}
                onPress={() => handleSelect(option.value)}
              >
                <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                  {option.label}
                </Text>
                {selected ? (
                  <CheckIcon size={14} color={theme.palette.sky.color} weight="bold" />
                ) : null}
              </Pressable>
            )
          })}
        </ScrollView>
      </Dropdown>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
    borderRadius: 10,
    padding: 12,
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: theme.neutral.textPrimary, fontSize: 13, fontWeight: '900' },
  description: { color: theme.neutral.textSecondary, fontSize: 10, fontWeight: '600' },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  valueText: {
    color: theme.neutral.textPrimary,
    fontSize: 11,
    fontWeight: '700',
    flexShrink: 1,
    paddingRight: 5,
  },
  placeholderText: { color: theme.neutral.textMuted },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  optionBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.control.divider,
  },
  optionSelected: { backgroundColor: theme.palette.sky.bg },
  optionPressed: { backgroundColor: interaction.pressedBg },
  optionText: {
    color: theme.control.text,
    fontSize: 14,
    fontWeight: '500',
  },
  optionTextSelected: {
    color: theme.palette.sky.color,
    fontWeight: '600',
  },
})
