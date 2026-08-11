import { StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { Input } from '@/components/forms/Input'

interface BoardInfoFormProps {
  name: string
  onChangeName: (value: string) => void
  nameTestID?: string
}

export function BoardInfoForm({ name, onChangeName, nameTestID }: BoardInfoFormProps) {
  return (
    <View style={styles.form}>
      <Text style={styles.label}>Board name</Text>
      <Input
        value={name}
        onChangeText={onChangeName}
        placeholderTextColor={theme.palette.slate.textDim}
        returnKeyType="next"
        testID={nameTestID}
        accessibilityLabel="Board name"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  form: {
    gap: 10,
  },
  label: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
})
