import { useEffect, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { EyeSlashIcon } from 'phosphor-react-native'
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
  error?: string | null
  onDismiss: () => void
  onIgnoreField?: (fieldId: string) => void
}

export function BoardConfigChangeNoticeModalView({
  visible,
  boardName,
  diffs,
  error,
  onDismiss,
  onIgnoreField,
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
      {diffs.map((diff) => (
        <View key={diff.fieldId} style={[styles.row, { borderBottomColor: neutral.border }]}>
          <View style={styles.rowText}>
            <Text style={styles.label}>{diff.label}</Text>
            <Text style={styles.change}>
              {value(diff.oldValue, diff.unit)} → {value(diff.newValue, diff.unit)}
            </Text>
          </View>
          {onIgnoreField ? (
            <IconButton
              icon={EyeSlashIcon}
              size="sm"
              accessibilityLabel={`Ignore ${diff.label}`}
              testID={`ignore-config-change-${diff.fieldId}`}
              onPress={() => onIgnoreField(diff.fieldId)}
            />
          ) : null}
        </View>
      ))}
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
      error={ignoreError}
      onDismiss={() => {
        setIgnoreError(null)
        void dismiss()
      }}
      onIgnoreField={
        board
          ? (fieldId) => {
              setIgnoreError(null)
              void setConfigChangeFieldIgnored(board.id, fieldId, true).catch(() => {
                setIgnoreError('Could not save ignored field.')
              })
            }
          : undefined
      }
    />
  )
}

const EMPTY_DIFFS: BoardConfigChangeDiff[] = []
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
  label: { color: theme.neutral.textPrimary, fontWeight: '700' },
  change: { color: theme.neutral.textSecondary, marginTop: 3 },
  error: { color: theme.status.error.text, fontSize: 12, marginTop: 8 },
})
