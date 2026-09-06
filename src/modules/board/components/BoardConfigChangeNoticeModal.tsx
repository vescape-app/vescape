import { View, StyleSheet } from 'react-native'
import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { FadeCardModal } from '@/components/modals/FadeCardModal'
import { theme } from '@/constants/theme'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { useBoardConfigChangeNoticeStore } from '@/modules/board/store/boardConfigChangeNoticeStore'

function value(v: number | boolean | null, unit: string | null): string {
  if (v === null) return 'Removed'
  const text = typeof v === 'boolean' ? (v ? 'On' : 'Off') : String(v)
  return unit && typeof v === 'number' ? `${text} ${unit}` : text
}
export function BoardConfigChangeNoticeModal() {
  const notice = useBoardConfigChangeNoticeStore((s) => s.notice)
  const dismiss = useBoardConfigChangeNoticeStore((s) => s.dismiss)
  const board = useBoardStore((s) => s.boards.find((b) => b.id === s.activeBoardId))
  const visible = !!notice && notice.boardId === board?.id
  return (
    <FadeCardModal
      visible={visible}
      title="Board configuration changed"
      showClose={false}
      onDismiss={() => void dismiss()}
      footer={<Button label="Dismiss" onPress={() => void dismiss()} />}
    >
      <Text style={styles.intro}>{board?.name ?? 'Board'} was changed outside Vescape.</Text>
      {notice?.diffs.map((diff) => (
        <View key={diff.fieldId} style={styles.row}>
          <Text style={styles.label}>{diff.label}</Text>
          <Text style={styles.change}>
            {value(diff.oldValue, diff.unit)} → {value(diff.newValue, diff.unit)}
          </Text>
        </View>
      ))}
    </FadeCardModal>
  )
}
const styles = StyleSheet.create({
  intro: { color: theme.palette.slate.textSecondary, marginBottom: 12 },
  row: {
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.palette.slate.border,
  },
  label: { color: theme.palette.slate.textPrimary, fontWeight: '700' },
  change: { color: theme.palette.slate.textSecondary, marginTop: 3 },
})
