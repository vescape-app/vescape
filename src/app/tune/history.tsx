import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlatList, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import {
  getBoardConfigRevisions,
  planBoardConfigRevert,
  type BoardConfigRevertPlan,
  type BoardConfigRevision,
} from 'vescape-core'

import { Banner } from '@/components/base/Banner'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { errorMessage } from '@/helpers/error'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { useUserPreferences } from '@/hooks/useUserPreferences'
import {
  RevisionRow,
  TuningSessionCard,
} from '@/modules/board/components/BoardConfigHistoryEntryRow'
import { BoardConfigReviewModal } from '@/modules/board/components/BoardConfigReviewModal'
import { buildBoardConfigReviewEntries } from '@/modules/board/lib/boardConfigChangeset'
import {
  applyPlannedBoardConfigRevert,
  resolveRevertReviewState,
} from '@/modules/board/lib/boardConfigRevert'
import {
  groupBoardConfigRevisions,
  type BoardConfigHistoryEntry,
} from '@/modules/board/lib/boardConfigRevisions'
import {
  useBoardConfigFields,
  useBoardConfigValuesStore,
} from '@/modules/board/store/boardConfigValuesStore'
import { useBoardStore } from '@/modules/board/store/boardStore'

export default function BoardConfigHistoryScreen() {
  const { boardId: paramBoardId } = useLocalSearchParams<{ boardId?: string }>()
  const neutral = useResolvedNeutralColors()
  const { timeFormat, dateFormat, temperatureUnit } = useUserPreferences()
  const activeBoardId = useBoardStore((s) => s.activeBoardId)
  const selectedBoardId = paramBoardId || activeBoardId
  const boardConfig = useBoardConfigFields(selectedBoardId ?? undefined)
  const lastCapturedAtMs = useBoardConfigValuesStore((s) => s.values?.capturedAtMs ?? null)

  const [revisions, setRevisions] = useState<BoardConfigRevision[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(() => new Set())
  const [planningRevisionId, setPlanningRevisionId] = useState<number | null>(null)
  const [pendingPlan, setPendingPlan] = useState<BoardConfigRevertPlan | null>(null)
  const [saving, setSaving] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  const reviewBoardId = pendingPlan?.boardId ?? selectedBoardId
  const board = useBoardStore((s) => s.boards.find((item) => item.id === reviewBoardId))
  const schemaHash = boardConfig?.schemaHash ?? null

  const canRevert =
    Boolean(selectedBoardId) &&
    boardConfig?.freshness === 'fresh' &&
    boardConfig.boardId === selectedBoardId

  useEffect(() => {
    setPendingPlan(null)
    setApplyError(null)
  }, [selectedBoardId, schemaHash])

  const load = useCallback(async (boardId: string) => {
    setLoading(true)
    setError(null)
    try {
      const rows = await getBoardConfigRevisions(boardId)
      setRevisions(rows)
    } catch (err) {
      setError(errorMessage(err, 'Unable to load config history.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedBoardId) {
      setRevisions([])
      return
    }
    void load(selectedBoardId)
  }, [lastCapturedAtMs, load, selectedBoardId])

  const entries = useMemo<BoardConfigHistoryEntry[]>(
    () => groupBoardConfigRevisions(revisions),
    [revisions],
  )
  const latestRevisionId = revisions[0]?.id ?? null

  const reviewEntries = useMemo(() => {
    if (!pendingPlan) return []
    return buildBoardConfigReviewEntries({
      changes: pendingPlan.changes,
      currentValues: boardConfig?.values ?? {},
      schema: boardConfig?.schema ?? null,
      refloatBaseVersion: boardConfig?.refloatBaseVersion ?? null,
      temperatureUnit,
    })
  }, [
    boardConfig?.refloatBaseVersion,
    boardConfig?.schema,
    boardConfig?.values,
    pendingPlan,
    temperatureUnit,
  ])

  const handleToggleSession = useCallback((sessionId: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }, [])

  const handlePlanRevert = useCallback(
    async (revisionId: number) => {
      if (!selectedBoardId || !canRevert) return
      setPlanningRevisionId(revisionId)
      setNotice(null)
      setError(null)
      setApplyError(null)
      try {
        const plan = await planBoardConfigRevert(selectedBoardId, revisionId)
        if (Object.keys(plan.changes).length === 0 && plan.skippedFields.length === 0) {
          setNotice('Board already matches this revision.')
          return
        }
        setPendingPlan(plan)
      } catch (err) {
        setError(errorMessage(err, 'Unable to plan config revert.'))
      } finally {
        setPlanningRevisionId(null)
      }
    },
    [canRevert, selectedBoardId],
  )

  const handleConfirmRevert = useCallback(async () => {
    setSaving(true)
    setApplyError(null)
    const outcome = await applyPlannedBoardConfigRevert({
      plan: pendingPlan,
      canRevert,
      connectedBoardId: boardConfig?.boardId,
      currentSchemaHash: schemaHash,
    })
    setSaving(false)
    if (outcome.kind === 'error') {
      setApplyError(outcome.message)
      return
    }
    if (outcome.kind !== 'applied') return
    useBoardConfigValuesStore.getState().replace(outcome.updated)
    setPendingPlan(null)
    await load(outcome.boardId)
  }, [boardConfig?.boardId, canRevert, load, pendingPlan, schemaHash])

  const revertModal = resolveRevertReviewState({
    plan: pendingPlan,
    selectedBoardId,
    connectedBoardId: boardConfig?.boardId,
    canRevert,
    applyError,
  })

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? (
        <View style={styles.bannerWrap}>
          <Banner variant="info" message={notice} />
        </View>
      ) : null}
      {selectedBoardId && revisions.length > 0 && !canRevert ? (
        <View style={styles.bannerWrap}>
          <Banner variant="info" message="Connect this board to revert to an earlier revision." />
        </View>
      ) : null}
      {!selectedBoardId ? (
        <Text style={styles.empty}>Select a board to view config history.</Text>
      ) : revisions.length === 0 && !loading ? (
        <Text style={styles.empty}>No config revisions recorded yet.</Text>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) =>
            item.kind === 'session' ? (
              <TuningSessionCard
                session={item}
                latestRevisionId={latestRevisionId}
                expanded={expandedSessions.has(item.id)}
                canRevert={canRevert}
                planningRevisionId={planningRevisionId}
                borderColor={neutral.border}
                timeFormat={timeFormat}
                dateFormat={dateFormat}
                temperatureUnit={temperatureUnit}
                onToggleExpand={() => handleToggleSession(item.id)}
                onRevert={(revisionId) => void handlePlanRevert(revisionId)}
              />
            ) : (
              <RevisionRow
                revision={item.revision}
                isCurrent={item.revision.id === latestRevisionId}
                canRevert={canRevert}
                planningRevisionId={planningRevisionId}
                borderColor={neutral.border}
                timeFormat={timeFormat}
                dateFormat={dateFormat}
                temperatureUnit={temperatureUnit}
                onRevert={(revisionId) => void handlePlanRevert(revisionId)}
              />
            )
          }
        />
      )}

      <BoardConfigReviewModal
        visible={revertModal.visible}
        source="revert"
        boardName={board?.name}
        entries={reviewEntries}
        skippedFields={pendingPlan?.skippedFields}
        saving={saving}
        confirmDisabled={revertModal.confirmDisabled}
        error={revertModal.error}
        onConfirm={handleConfirmRevert}
        onCancel={() => {
          if (!saving) {
            setPendingPlan(null)
            setApplyError(null)
          }
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.neutral.bg,
  },
  bannerWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  error: {
    color: theme.status.error.text,
    fontSize: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  empty: {
    color: theme.neutral.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 24,
  },
  list: {
    padding: 16,
    paddingBottom: 32,
  },
})
