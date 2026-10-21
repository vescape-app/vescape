import { useState } from 'react'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'
import { PencilSimpleIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

interface BoardNameFieldProps {
  name: string
  saving?: boolean
  onSave: (name: string) => Promise<void> | void
}

/** Board name shown inline in the hero, with an inline pencil that swaps it for a text input. */
export function BoardNameField({ name, saving = false, onSave }: BoardNameFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = () => {
    const next = (draft ?? '').trim()
    setDraft(null)
    if (next && next !== name) void onSave(next)
  }

  if (draft !== null) {
    return (
      <TextInput
        style={[styles.title, styles.input]}
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={commit}
        onBlur={commit}
        autoFocus
        selectTextOnFocus
        returnKeyType="done"
        editable={!saving}
        placeholder="Board name"
        placeholderTextColor={theme.neutral.textDim}
        testID="edit-board-name-input"
        accessibilityLabel="Board name"
      />
    )
  }

  return (
    <Pressable
      style={styles.row}
      hitSlop={8}
      onPress={() => setDraft(name)}
      testID="edit-board-name-edit"
      accessibilityLabel="Edit board name"
    >
      <Text style={styles.title}>{name.trim() || 'Unnamed board'}</Text>
      <View style={styles.editIcon}>
        <PencilSimpleIcon size={18} color={theme.neutral.textPrimary} weight="duotone" />
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: theme.neutral.textPrimary,
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
  },
  input: {
    alignSelf: 'stretch',
    fontFamily: theme.font('700'),
    borderBottomWidth: 1,
    borderBottomColor: theme.neutral.border,
    paddingVertical: 4,
  },
  editIcon: { transform: [{ translateY: 3 }] },
})
