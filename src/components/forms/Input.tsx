import { forwardRef } from 'react'
import { StyleSheet, TextInput, type TextInputProps } from 'react-native'
import { theme } from '@/constants/theme'

export const inputBase = {
  backgroundColor: theme.control.background,
  borderWidth: 1,
  borderColor: theme.control.border,
  borderRadius: 8,
  paddingHorizontal: 14,
  paddingVertical: 12,
  color: theme.control.text,
  fontSize: 15,
  // TextInput bypasses the Text wrapper, so the Raleway family is set directly.
  fontFamily: theme.font('600'),
}

type InputProps = TextInputProps

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { style, placeholderTextColor = theme.control.textMuted, ...props },
  ref,
) {
  return (
    <TextInput
      ref={ref}
      style={[styles.input, style]}
      placeholderTextColor={placeholderTextColor}
      {...props}
    />
  )
})

const styles = StyleSheet.create({
  input: { ...inputBase },
})
