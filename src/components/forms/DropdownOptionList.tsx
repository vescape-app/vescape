import { Pressable, ScrollView, StyleSheet } from 'react-native'
import { CheckIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { useColoredControlSurface } from '@/components/controls/coloredControlSurface'
import type { SelectOption } from '@/components/forms/Select'
import { theme } from '@/constants/theme'

interface DropdownOptionListProps<T extends string> {
  options: SelectOption<T>[]
  value: T
  onSelect: (value: T) => void
  testID?: string
}

/**
 * The option rows inside a `Dropdown`. The menu is a navy control surface in both appearances, so
 * rows use the control colors, and the chosen row wears the same colored surface as a selected
 * switch or radio.
 */
export function DropdownOptionList<T extends string>({
  options,
  value,
  onSelect,
  testID,
}: DropdownOptionListProps<T>) {
  const surface = useColoredControlSurface(theme.palette.sky.color)

  return (
    <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <Pressable
            key={option.value}
            {...(testID ? { testID: `${testID}-option-${option.value}` } : {})}
            style={({ pressed }) => [
              styles.option,
              index < options.length - 1 && styles.optionBorder,
              selected && { backgroundColor: surface.selected },
              pressed && styles.optionPressed,
            ]}
            onPress={() => onSelect(option.value)}
            accessibilityRole="menuitem"
            accessibilityState={{ selected }}
          >
            <Text
              style={[styles.optionText, selected && { color: surface.tint, fontWeight: '600' }]}
            >
              {option.label}
            </Text>
            {selected ? <CheckIcon size={14} color={surface.tint} weight="bold" /> : null}
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
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
  optionPressed: {
    backgroundColor: theme.control.backgroundPressed,
  },
  optionText: {
    color: theme.control.text,
    fontSize: 14,
    fontWeight: '500',
  },
})
