import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { EngineIcon } from 'phosphor-react-native'
import type { BoardWarning } from 'vescape-core'

import { Button } from '@/components/base/Button'
import { Placeholder } from '@/components/base/Placeholder'
import { Text } from '@/components/base/Text'
import { BoardWarningRow } from '@/modules/board/components/BoardWarningRow'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { useBoardWarningsStore } from '@/modules/board/store/boardWarningsStore'
import { theme } from '@/constants/theme'

interface BoardWarningsSheetProps {
  boardId: string
  warnings: BoardWarning[]
}

/**
 * Warnings sheet for the selected Board. Active warnings list first, dismissed (acknowledged) ones
 * grayed below — dismissing never deletes from the native registry, it only persists the kind on the
 * board record, so the row stays visible here while the board warning indicator ignores it.
 */
export function BoardWarningsSheet({ boardId, warnings }: BoardWarningsSheetProps) {
  const [mutationError, setMutationError] = useState<string | null>(null)
  const readError = useBoardWarningsStore((state) => state.error)
  const dismissedKinds = useBoardStore(
    (s) => s.boards.find((b) => b.id === boardId)?.dismissedWarnings ?? EMPTY_KINDS,
  )
  const setWarningDismissed = useBoardStore((s) => s.setWarningDismissed)
  const dismissAllWarnings = useBoardStore((s) => s.dismissAllWarnings)

  if (warnings.length === 0 && !readError) {
    return (
      <View style={styles.empty}>
        <Placeholder icon={EngineIcon} title="No warnings" description="This board is clean." />
      </View>
    )
  }

  const active = warnings.filter((w) => !dismissedKinds.includes(w.kind))
  const dismissed = warnings.filter((w) => dismissedKinds.includes(w.kind))

  return (
    <View style={styles.list}>
      {warnings.length === 0 ? (
        <Placeholder icon={EngineIcon} title="Warnings unavailable" description={readError ?? ''} />
      ) : null}
      {[...active, ...dismissed].map((warning) => (
        <BoardWarningRow
          key={warning.kind}
          warning={warning}
          dismissed={dismissedKinds.includes(warning.kind)}
          onSetDismissed={(kind, value) => {
            setMutationError(null)
            void setWarningDismissed(boardId, kind, value).catch(() => {
              setMutationError('Warning dismissal could not be saved.')
            })
          }}
        />
      ))}
      {active.length > 1 && (
        <Button
          label="Dismiss all"
          variant="secondary"
          onPress={() => {
            setMutationError(null)
            void dismissAllWarnings(
              boardId,
              active.map((w) => w.kind),
            ).catch(() => setMutationError('Warning dismissals could not be saved.'))
          }}
        />
      )}
      {mutationError || readError ? (
        <Text style={styles.error}>{mutationError ?? readError}</Text>
      ) : null}
    </View>
  )
}

/** Stable empty array so the selector doesn't churn references for boards with nothing dismissed. */
const EMPTY_KINDS: string[] = []

const styles = StyleSheet.create({
  list: {
    gap: 10,
  },
  empty: {
    paddingVertical: 12,
  },
  error: {
    color: theme.status.error.text,
    fontSize: 12,
  },
})
