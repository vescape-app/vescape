import { useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { CheckIcon, PencilSimpleIcon } from 'phosphor-react-native'

import { Input } from '@/components/forms/Input'
import { TextPromptModal } from '@/components/modals/TextPromptModal'
import {
  useResolvedSecondaryWidgetSurface,
  type WidgetSize,
} from '@/components/widgets/widgetSurface'
import { theme } from '@/constants/theme'

interface InputWidgetProps {
  label: string
  value: string | null
  placeholder?: string
  maxLength?: number
  size?: WidgetSize
  onCommit: (value: string) => void
  accessibilityLabel?: string
  /** Optional visual rendered at the leading edge of a row input. */
  leading?: ReactNode
  /** Optional content shown below the input while the row is being edited. */
  editingContent?: ReactNode
  /** Keep the row editor open when the input loses focus, so inline controls remain usable. */
  commitOnBlur?: boolean
}

/** A labelled value that flips to an inline text field when the pencil is tapped. */
export function InputWidget(props: InputWidgetProps) {
  if (props.size === 'square') return <SquareInput {...props} />
  return <RowInput {...props} />
}

function RowInput({
  label,
  value,
  placeholder,
  maxLength,
  onCommit,
  accessibilityLabel,
  leading,
  editingContent,
  commitOnBlur = true,
}: InputWidgetProps) {
  const surface = useResolvedSecondaryWidgetSurface()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const startEdit = () => {
    setDraft(value ?? '')
    setEditing(true)
  }

  const commit = () => {
    if (draft.trim() !== (value ?? '')) onCommit(draft)
    setEditing(false)
  }

  return (
    <View style={[surface, editing ? styles.widgetEditing : styles.widgetRow]}>
      <View style={styles.headerRow}>
        {leading}
        <View style={styles.content}>
          <View style={styles.text}>
            <Text style={styles.label}>{label}</Text>
            {editing ? (
              <Input
                value={draft}
                onChangeText={setDraft}
                onBlur={commitOnBlur ? commit : undefined}
                onSubmitEditing={commit}
                placeholder={placeholder}
                placeholderTextColor={theme.control.textMuted}
                returnKeyType="done"
                maxLength={maxLength}
                autoFocus
                style={styles.input}
                accessibilityLabel={accessibilityLabel ?? label}
              />
            ) : (
              <Text style={styles.value} numberOfLines={1}>
                {value?.trim() || placeholder}
              </Text>
            )}
          </View>
        </View>
        <Pressable
          onPress={editing ? commit : startEdit}
          hitSlop={10}
          style={styles.editBtn}
          accessibilityLabel={editing ? 'Save' : 'Edit'}
        >
          {editing ? (
            <CheckIcon size={18} color={theme.palette.green.color} weight="bold" />
          ) : (
            <PencilSimpleIcon size={18} color={theme.control.textMuted} weight="bold" />
          )}
        </Pressable>
      </View>
      {editing && editingContent ? (
        <View style={styles.editingContent}>{editingContent}</View>
      ) : null}
    </View>
  )
}

function SquareInput({
  label,
  value,
  placeholder,
  maxLength,
  onCommit,
  accessibilityLabel,
  leading,
}: InputWidgetProps) {
  const surface = useResolvedSecondaryWidgetSurface()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Pressable
        style={({ pressed }) => [surface, styles.widgetSquare, pressed && styles.pressed]}
        onPress={() => setOpen(true)}
        accessibilityLabel={accessibilityLabel ?? `Edit ${label}`}
      >
        <Text style={styles.label}>{label}</Text>
        <View style={styles.squareFooter}>
          {leading}
          <Text style={styles.value} numberOfLines={2}>
            {value?.trim() || placeholder}
          </Text>
        </View>
      </Pressable>
      <TextPromptModal
        visible={open}
        title={label}
        placeholder={placeholder}
        initialValue={value ?? ''}
        confirmLabel="Save"
        onConfirm={(next) => {
          onCommit(maxLength ? next.slice(0, maxLength) : next)
          setOpen(false)
        }}
        onDismiss={() => setOpen(false)}
      />
    </>
  )
}

const styles = StyleSheet.create({
  widgetRow: {
    padding: 16,
  },
  widgetEditing: {
    gap: 14,
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  widgetSquare: {
    aspectRatio: 1,
    justifyContent: 'space-between',
    gap: 8,
    padding: 14,
  },
  pressed: {
    backgroundColor: theme.neutral.surface,
  },
  text: {
    minWidth: 0,
    gap: 4,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  editingContent: {
    minWidth: 0,
  },
  label: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  value: {
    color: theme.neutral.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
    minWidth: 0,
  },
  input: {
    paddingVertical: 6,
  },
  squareFooter: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  editBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
