import { useEffect, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { ArrowCounterClockwiseIcon, EyeSlashIcon } from 'phosphor-react-native'
import type { BoardConfigChangeDiff } from 'vescape-core'
import { Button } from '@/components/base/Button'
import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { FadeCardModal } from '@/components/modals/FadeCardModal'
import { theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { useBoardConfigChangeNoticeStore } from '@/modules/board/store/boardConfigChangeNoticeStore'

function value(v: number | boolean | null, unit: string | null): string {
  if (v === null) return 'Removed'
  const text = typeof v === 'boolean' ? (v ? 'On' : 'Off') : String(v)
  return unit && typeof v === 'number' ? `${text} ${unit}` : text
}

interface BoardConfigChangeNoticeModalViewProps {
  visible: boolean
  boardName: string
  diffs: BoardConfigChangeDiff[]
  ignoredFields?: string[]
  error?: string | null
  onDismiss: () => void
  onToggleIgnoreField?: (fieldId: string, ignored: boolean) => void
}

export function BoardConfigChangeNoticeModalView({
  visible,
  boardName,
  diffs,
  ignoredFields = EMPTY_FIELDS,
  error,
  onDismiss,
  onToggleIgnoreField,
}: BoardConfigChangeNoticeModalViewProps) {
  const neutral = useResolvedNeutralColors()
  return (
    <FadeCardModal
      visible={visible}
      title="Board configuration changed"
      showClose={false}
      onDismiss={onDismiss}
      footer={<Button label="Dismiss" onPress={onDismiss} />}
    >
      <Text style={styles.intro}>{boardName} was changed outside Vescape.</Text>
      {diffs.map((diff) => {
        const ignored = ignoredFields.includes(diff.fieldId)
        return (
          <View key={diff.fieldId} style={[styles.row, { borderBottomColor: neutral.border }]}>
            <View style={[styles.rowText, ignored && styles.rowTextIgnored]}>
              <Text style={styles.label}>{diff.label}</Text>
              <Text style={styles.change}>
                {value(diff.oldValue, diff.unit)} → {value(diff.newValue, diff.unit)}
              </Text>
              {ignored ? <Text style={styles.ignoredNote}>Will be ignored next time</Text> : null}
            </View>
            {onToggleIgnoreField ? (
              <IconButton
                icon={ignored ? ArrowCounterClockwiseIcon : EyeSlashIcon}
                size="sm"
                accessibilityLabel={
                  ignored ? `Stop ignoring ${diff.label}` : `Ignore ${diff.label}`
                }
                testID={`ignore-config-change-${diff.fieldId}`}
                onPress={() => onToggleIgnoreField(diff.fieldId, !ignored)}
              />
            ) : null}
          </View>
        )
      })}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </FadeCardModal>
  )
}

export function BoardConfigChangeNoticeModal() {
  const [ignoreError, setIgnoreError] = useState<string | null>(null)
  const notice = useBoardConfigChangeNoticeStore((s) => s.notice)
  const dismiss = useBoardConfigChangeNoticeStore((s) => s.dismiss)
  const board = useBoardStore((s) => s.boards.find((b) => b.id === s.activeBoardId))
  const setConfigChangeFieldIgnored = useBoardStore((s) => s.setConfigChangeFieldIgnored)
  const visible = !!notice && notice.boardId === board?.id

  useEffect(() => {
    setIgnoreError(null)
  }, [notice?.detectedAtMs, visible])

  return (
    <BoardConfigChangeNoticeModalView
      visible={visible}
      boardName={board?.name ?? 'Board'}
      diffs={notice?.diffs ?? EMPTY_DIFFS}
      ignoredFields={board?.ignoredConfigChangeFields ?? EMPTY_FIELDS}
      error={ignoreError}
      onDismiss={() => {
        setIgnoreError(null)
        void dismiss()
      }}
      onToggleIgnoreField={
        board
          ? (fieldId, ignored) => {
              setIgnoreError(null)
              void setConfigChangeFieldIgnored(board.id, fieldId, ignored).catch(() => {
                setIgnoreError('Could not update ignored field.')
              })
            }
          : undefined
      }
    />
  )
}

const EMPTY_DIFFS: BoardConfigChangeDiff[] = []
const EMPTY_FIELDS: string[] = []
const styles = StyleSheet.create({
  intro: { color: theme.neutral.textSecondary, marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1 },
  rowTextIgnored: { opacity: 0.55 },
  label: { color: theme.neutral.textPrimary, fontWeight: '700' },
  change: { color: theme.neutral.textSecondary, marginTop: 3 },
  ignoredNote: { color: theme.neutral.textMuted, fontSize: 12, marginTop: 3 },
  error: { color: theme.status.error.text, fontSize: 12, marginTop: 8 },
})
