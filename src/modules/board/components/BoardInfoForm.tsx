import { StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { Input } from '@/components/forms/Input'

interface BoardInfoFormProps {
  name: string
  description: string
  onChangeName: (value: string) => void
  onChangeDescription: (value: string) => void
  nameTestID?: string
  descriptionTestID?: string
}

export function BoardInfoForm({
  name,
  description,
  onChangeName,
  onChangeDescription,
  nameTestID,
  descriptionTestID,
}: BoardInfoFormProps) {
  return (
    <View style={styles.form}>
      <Text style={styles.label}>Board name</Text>
      <Input
        value={name}
        onChangeText={onChangeName}
        placeholderTextColor={theme.neutral.textDim}
        returnKeyType="next"
        testID={nameTestID}
        accessibilityLabel="Board name"
      />
      <Text style={styles.label}>Description</Text>
      <Input
        style={styles.inputMultiline}
        value={description}
        onChangeText={onChangeDescription}
        placeholder="Optional"
        placeholderTextColor={theme.neutral.textDim}
        multiline
        numberOfLines={3}
        textAlignVertical="top"
        testID={descriptionTestID}
        accessibilityLabel="Board description"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  form: {
    gap: 10,
  },
  label: {
    color: theme.neutral.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  inputMultiline: {
    minHeight: 84,
    paddingTop: 12,
  },
})
