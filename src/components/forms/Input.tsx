import { forwardRef } from 'react'
import { StyleSheet, TextInput, type TextInputProps } from 'react-native'
import { theme } from '@/constants/theme'
import { useResolvedColor, useResolvedControlColors } from '@/hooks/useTheme'

export const inputBase = {
  borderWidth: 1,
  borderRadius: 8,
  paddingHorizontal: 14,
  paddingVertical: 12,
  fontSize: 15,
  // TextInput bypasses the Text wrapper, so the Raleway family is set directly.
  fontFamily: theme.font('600'),
}

type InputProps = TextInputProps

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { style, placeholderTextColor, ...props },
  ref,
) {
  const control = useResolvedControlColors()
  const resolvedPlaceholderTextColor = useResolvedColor(
    (placeholderTextColor ?? theme.control.textMuted) as string,
  )

  return (
    <TextInput
      ref={ref}
      style={[
        styles.input,
        {
          backgroundColor: control.background,
          borderColor: control.border,
          color: control.text,
        },
        style,
      ]}
      placeholderTextColor={resolvedPlaceholderTextColor}
      {...props}
    />
  )
})

const styles = StyleSheet.create({
  input: { ...inputBase },
})
