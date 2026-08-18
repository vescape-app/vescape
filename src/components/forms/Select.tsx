import { useCallback, useRef, useState } from 'react'
import type { View } from 'react-native'
import { Pressable, ScrollView, StyleSheet } from 'react-native'
import { Text } from '@/components/base/Text'
import { CaretDownIcon, CheckIcon } from 'phosphor-react-native'

import { interaction, theme } from '@/constants/theme'
import { Dropdown } from '@/components/forms/Dropdown'
import { inputBase } from '@/components/forms/Input'

const MAX_DROPDOWN_HEIGHT = 280

export interface SelectOption<T extends string = string> {
  label: string
  value: T
}

interface SelectProps<T extends string = string> {
  options: SelectOption<T>[]
  value: T
  onChange: (value: T) => void
  placeholder?: string
  style?: View['props']['style']
}

export function Select<T extends string = string>({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  style,
}: SelectProps<T>) {
  const triggerRef = useRef<View>(null)
  const [open, setOpen] = useState(false)

  const selectedOption = options.find((o) => o.value === value)

  const handleSelect = useCallback(
    (optionValue: T) => {
      onChange(optionValue)
      setOpen(false)
    },
    [onChange],
  )

  return (
    <>
      <Pressable ref={triggerRef} style={[styles.trigger, style]} onPress={() => setOpen(true)}>
        <Text style={[styles.triggerText, !selectedOption && styles.placeholderText]}>
          {selectedOption?.label ?? placeholder}
        </Text>
        <CaretDownIcon size={14} color={theme.neutral.textMuted} weight="bold" />
      </Pressable>

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
    </>
  )
}

const styles = StyleSheet.create({
  trigger: {
    ...inputBase,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 0,
    height: 42,
  },
  triggerText: {
    color: theme.neutral.textPrimary,
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  placeholderText: {
    color: theme.neutral.textMuted,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  optionBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.neutral.border,
  },
  optionSelected: {
    backgroundColor: theme.palette.sky.bg,
  },
  optionPressed: {
    backgroundColor: interaction.pressedBg,
  },
  optionText: {
    color: theme.neutral.textPrimary,
    fontSize: 14,
    fontWeight: '500',
  },
  optionTextSelected: {
    color: theme.palette.sky.color,
    fontWeight: '600',
  },
})
