import { useCallback, useRef, useState } from 'react'
import type { View } from 'react-native'
import { Pressable, StyleSheet } from 'react-native'
import { Text } from '@/components/base/Text'
import { CaretDownIcon } from 'phosphor-react-native'

import { theme } from '@/constants/theme'
import { Dropdown } from '@/components/forms/Dropdown'
import { DropdownOptionList } from '@/components/forms/DropdownOptionList'
import { inputBase } from '@/components/forms/Input'
import { useResolvedControlColors } from '@/hooks/useTheme'

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
  testID?: string
}

export function Select<T extends string = string>({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  style,
  testID,
}: SelectProps<T>) {
  const triggerRef = useRef<View>(null)
  const [open, setOpen] = useState(false)
  const control = useResolvedControlColors()

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
      <Pressable
        ref={triggerRef}
        style={[
          styles.trigger,
          {
            backgroundColor: control.background,
            borderColor: control.border,
          },
          style,
        ]}
        testID={testID}
        onPress={() => setOpen(true)}
      >
        <Text
          style={[styles.triggerText, { color: selectedOption ? control.text : control.textMuted }]}
        >
          {selectedOption?.label ?? placeholder}
        </Text>
        <CaretDownIcon size={14} color={control.textMuted} weight="bold" />
      </Pressable>

      <Dropdown
        visible={open}
        triggerRef={triggerRef}
        onClose={() => setOpen(false)}
        maxHeight={MAX_DROPDOWN_HEIGHT}
      >
        <DropdownOptionList
          options={options}
          value={value}
          onSelect={handleSelect}
          {...(testID ? { testID } : {})}
        />
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
})
