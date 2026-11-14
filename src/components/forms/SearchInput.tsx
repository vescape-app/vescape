import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { MagnifyingGlassIcon, XIcon } from 'phosphor-react-native'

import { IconButton } from '@/components/base/IconButton'
import { Input } from '@/components/forms/Input'
import { useResolvedControlColors } from '@/hooks/useTheme'

interface SearchInputProps {
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  accessibilityLabel?: string
  testID?: string
  style?: StyleProp<ViewStyle>
}

export function SearchInput({
  value,
  onChangeText,
  placeholder = 'Search',
  accessibilityLabel = placeholder,
  testID,
  style,
}: SearchInputProps) {
  const control = useResolvedControlColors()

  return (
    <View style={[styles.container, style]}>
      <Input
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        style={styles.input}
      />
      <View pointerEvents="none" style={styles.icon}>
        <MagnifyingGlassIcon size={18} color={control.textMuted} weight="bold" />
      </View>
      {value ? (
        <IconButton
          icon={XIcon}
          variant="ghost"
          iconColor={control.icon}
          accessibilityLabel="Clear search"
          onPress={() => onChangeText('')}
          style={styles.clear}
          testID={testID ? `${testID}-clear` : undefined}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { justifyContent: 'center' },
  input: {
    height: 40,
    borderRadius: 999,
    paddingVertical: 8,
    paddingLeft: 36,
    paddingRight: 44,
    fontSize: 14,
  },
  icon: { position: 'absolute', left: 12 },
  clear: { position: 'absolute', right: 1 },
})
