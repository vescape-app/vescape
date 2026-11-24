import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FlatList, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useNavigation } from 'expo-router'
import {
  getBoardConfigRevisions,
  planBoardConfigRevert,
  type BoardConfigRevertPlan,
  type BoardConfigRevision,
} from 'vescape-core'

import { Banner } from '@/components/base/Banner'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { formatDateTime } from '@/helpers/time'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { useUserPreferences } from '@/hooks/useUserPreferences'
import {
  RevisionRow,
  TuningSessionCard,
} from '@/modules/board/components/BoardConfigHistoryEntryRow'
import { BoardConfigReviewModal } from '@/modules/board/components/BoardConfigReviewModal'
import { buildBoardConfigReviewEntries } from '@/modules/board/lib/boardConfigChangeset'
import { boardConfigErrorMessage } from '@/modules/board/lib/boardConfigErrors'
import {
  applyPlannedBoardConfigRevert,
  resolveRevertReviewState,
} from '@/modules/board/lib/boardConfigRevert'
import {
  groupBoardConfigRevisions,
  type BoardConfigHistoryEntry,
} from '@/modules/board/lib/boardConfigRevisions'
import {
  getFieldOverlay,
  resolveBoardConfigField,
  type ResolvedBoardConfigField,
} from '@/modules/board/lib/refloatFieldOverlay'
import { useBleStore } from '@/modules/board/store/bleStore'
import {
  useBoardConfigFields,
  useBoardConfigValuesStore,
} from '@/modules/board/store/boardConfigValuesStore'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { useTuneProfileStore } from '@/modules/tune/store/tuneProfileStore'

function buildResolvedFieldsById(
  boardConfig: ReturnType<typeof useBoardConfigFields>,
): Record<string, ResolvedBoardConfigField> {
  const schema = boardConfig?.schema
  if (!schema) return {}
  const map: Record<string, ResolvedBoardConfigField> = {}
  for (const field of schema.fields) {
    map[field.id] = resolveBoardConfigField(
      field,
      boardConfig.values[field.id] ?? (field.type === 'bool' ? false : 0),
      getFieldOverlay(field.id),
    )
  }
  return map
}

function buildRevertModalCopy(
  plan: BoardConfigRevertPlan | null,
  timeFormat: ReturnType<typeof useUserPreferences>['timeFormat'],
  dateFormat: ReturnType<typeof useUserPreferences>['dateFormat'],
): { contextLabel: string | null; contextWarning: string | null } {
  if (!plan) return { contextLabel: null, contextWarning: null }
  const versionSuffix = plan.targetRefloatVersion ? ` (Refloat ${plan.targetRefloatVersion})` : ''
  return {
    contextLabel: `Restoring config from ${formatDateTime(plan.targetCreatedAtMs, timeFormat, dateFormat)}${versionSuffix}`,
    contextWarning: plan.sameSchema
      ? null
      : 'This revision was saved on a different firmware schema. Only matching fields will be restored.',
  }
}

function HistoryBanners({
  error,
  notice,
  showOfflineBanner,
  isBoardConnected,
}: {
  error: string | null
  notice: string | null
  showOfflineBanner: boolean
  isBoardConnected: boolean
}) {
  return (
    <>
      {error ? (
        <View style={styles.bannerWrap}>
          <Banner variant="error" message={error} />
        </View>
      ) : null}
      {notice ? (
        <View style={styles.bannerWrap}>
          <Banner variant="info" message={notice} />
        </View>
      ) : null}
      {showOfflineBanner ? (
        <View style={styles.bannerWrap}>
          <Banner
            variant="info"
            message={
              isBoardConnected
                ? 'Waiting for a fresh config read before reverting.'
                : 'Connect this board to revert to an earlier revision.'
            }
          />
        </View>
      ) : null}
    </>
  )
}

function resolveHistoryEmptyMessage(params: {
  selectedBoardId: string | null
  loading: boolean
  revisionCount: number
  error: string | null
}): string | null {
  if (!params.selectedBoardId) return 'Select a board to view config history.'
  if (params.loading && params.revisionCount === 0) return 'Loading config history…'
  if (params.revisionCount === 0 && !params.error) return 'No config revisions recorded yet.'
  return null
}

function HistoryList({
  entries,
  latestRevisionId,
  oldestRevisionId,
  expandedSessions,
  canRevert,
  planningRevisionId,
  borderColor,
  timeFormat,
  dateFormat,
  temperatureUnit,
  resolvedFieldsById,
  profileNamesById,
  onToggleSession,
  onRevert,
}: {
  entries: BoardConfigHistoryEntry[]
  latestRevisionId: number | null
  oldestRevisionId: number | null
  expandedSessions: Set<string>
  canRevert: boolean
  planningRevisionId: number | null
  borderColor: string
  timeFormat: ReturnType<typeof useUserPreferences>['timeFormat']
  dateFormat: ReturnType<typeof useUserPreferences>['dateFormat']
  temperatureUnit: ReturnType<typeof useUserPreferences>['temperatureUnit']
  resolvedFieldsById: Readonly<Record<string, ResolvedBoardConfigField>>
  profileNamesById: Readonly<Record<string, string>>
  onToggleSession: (sessionId: string) => void
  onRevert: (revisionId: number) => void
}) {
  return (
    <FlatList
      data={entries}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      renderItem={({ item }) =>
        item.kind === 'session' ? (
          <TuningSessionCard
            session={item}
            latestRevisionId={latestRevisionId}
            oldestRevisionId={oldestRevisionId}
            expanded={expandedSessions.has(item.id)}
            canRevert={canRevert}
            planningRevisionId={planningRevisionId}
            borderColor={borderColor}
            timeFormat={timeFormat}
            dateFormat={dateFormat}
            temperatureUnit={temperatureUnit}
            resolvedFieldsById={resolvedFieldsById}
            profileNamesById={profileNamesById}
            onToggleExpand={() => onToggleSession(item.id)}
            onRevert={onRevert}
          />
        ) : (
          <RevisionRow
            revision={item.revision}
            isCurrent={item.revision.id === latestRevisionId}
            isOldest={item.revision.id === oldestRevisionId}
            canRevert={canRevert}
            planningRevisionId={planningRevisionId}
            borderColor={borderColor}
            timeFormat={timeFormat}
            dateFormat={dateFormat}
            temperatureUnit={temperatureUnit}
            resolvedFieldsById={resolvedFieldsById}
            profileNamesById={profileNamesById}
            onRevert={onRevert}
          />
        )
      }
    />
  )
}

function useBoardConfigHistoryRevisions(
  selectedBoardId: string | null,
  lastCapturedAtMs: number | null,
) {
  const [revisions, setRevisions] = useState<BoardConfigRevision[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadGenerationRef = useRef(0)

  const load = useCallback(async (boardId: string) => {
    const generation = ++loadGenerationRef.current
    setLoading(true)
    setError(null)
    try {
      const rows = await getBoardConfigRevisions(boardId)
      if (loadGenerationRef.current !== generation) return
      setRevisions(rows)
    } catch (err) {
      if (loadGenerationRef.current !== generation) return
      setError(boardConfigErrorMessage(err, 'Unable to load config history.'))
    } finally {
      if (loadGenerationRef.current === generation) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    if (!selectedBoardId) {
      loadGenerationRef.current += 1
      setRevisions([])
      setLoading(false)
      setError(null)
      return
    }
    void load(selectedBoardId)
  }, [lastCapturedAtMs, load, selectedBoardId])

  return { revisions, loading, error, setError }
}

function computeHistoryBoardState(params: {
  selectedBoardId: string | null
  activeBoardId: string | null
  bleStatus: string
  boardConfig: ReturnType<typeof useBoardConfigFields>
  pendingPlan: BoardConfigRevertPlan | null
  revisions: BoardConfigRevision[]
}) {
  const { selectedBoardId, activeBoardId, bleStatus, boardConfig, pendingPlan, revisions } = params
  return {
    reviewBoardId: pendingPlan?.boardId ?? selectedBoardId,
    schemaHash: boardConfig?.schemaHash ?? null,
    currentCapturedAtMs: boardConfig?.capturedAtMs ?? null,
    isBoardConnected: Boolean(
      selectedBoardId && bleStatus === 'connected' && activeBoardId === selectedBoardId,
    ),
    canRevert: Boolean(
      selectedBoardId &&
      boardConfig?.freshness === 'fresh' &&
      boardConfig.boardId === selectedBoardId,
    ),
    latestRevisionId: revisions[0]?.id ?? null,
    oldestRevisionId: revisions[revisions.length - 1]?.id ?? null,
  }
}

export default function BoardConfigHistoryScreen() {
  const { boardId: paramBoardId } = useLocalSearchParams<{ boardId?: string }>()
  const navigation = useNavigation()
  const neutral = useResolvedNeutralColors()
  const { timeFormat, dateFormat, temperatureUnit } = useUserPreferences()
  const activeBoardId = useBoardStore((s) => s.activeBoardId)
  const selectedBoardId = paramBoardId || activeBoardId
  const boardConfig = useBoardConfigFields(selectedBoardId ?? undefined)
  const lastCapturedAtMs = useBoardConfigValuesStore((s) => s.values?.capturedAtMs ?? null)
  const bleStatus = useBleStore((s) => s.status)
  const profiles = useTuneProfileStore((s) => s.profiles)

  const { revisions, loading, error, setError } = useBoardConfigHistoryRevisions(
    selectedBoardId,
    lastCapturedAtMs,
  )
  const [notice, setNotice] = useState<string | null>(null)
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(() => new Set())
  const [planningRevisionId, setPlanningRevisionId] = useState<number | null>(null)
  const [pendingPlan, setPendingPlan] = useState<BoardConfigRevertPlan | null>(null)
  const [plannedCapturedAtMs, setPlannedCapturedAtMs] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  const {
    reviewBoardId,
    schemaHash,
    currentCapturedAtMs,
    isBoardConnected,
    canRevert,
    latestRevisionId,
    oldestRevisionId,
  } = computeHistoryBoardState({
    selectedBoardId,
    activeBoardId,
    bleStatus,
    boardConfig,
    pendingPlan,
    revisions,
  })
  const board = useBoardStore((s) => s.boards.find((item) => item.id === reviewBoardId))

  useLayoutEffect(() => {
    navigation.setOptions({
      title: board?.name ? `${board.name} · History` : 'Config History',
    })
  }, [board?.name, navigation])

  useEffect(() => {
    setPendingPlan(null)
    setPlannedCapturedAtMs(null)
    setApplyError(null)
    setNotice(null)
  }, [selectedBoardId, schemaHash])

  const resolvedFieldsById = useMemo(() => buildResolvedFieldsById(boardConfig), [boardConfig])

  const profileNamesById = useMemo<Record<string, string>>(
    () => Object.fromEntries(profiles.map((profile) => [profile.id, profile.name])),
    [profiles],
  )

  const entries = useMemo<BoardConfigHistoryEntry[]>(
    () => groupBoardConfigRevisions(revisions),
    [revisions],
  )

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
        if (Object.keys(plan.changes).length === 0) {
          setNotice(
            plan.skippedFields.length > 0
              ? `No writable changes to restore (${plan.skippedFields.length} skipped).`
              : 'Board already matches this revision.',
          )
          return
        }
        setPendingPlan(plan)
        setPlannedCapturedAtMs(currentCapturedAtMs)
      } catch (err) {
        setError(boardConfigErrorMessage(err, 'Unable to plan config revert.'))
      } finally {
        setPlanningRevisionId(null)
      }
    },
    [canRevert, currentCapturedAtMs, selectedBoardId],
  )

  const handleConfirmRevert = useCallback(async () => {
    setSaving(true)
    setApplyError(null)
    const outcome = await applyPlannedBoardConfigRevert({
      plan: pendingPlan,
      canRevert,
      connectedBoardId: boardConfig?.boardId,
      currentSchemaHash: schemaHash,
      plannedCapturedAtMs,
      currentCapturedAtMs,
    })
    setSaving(false)
    if (outcome.kind === 'error') {
      setApplyError(outcome.message)
      return
    }
    if (outcome.kind !== 'applied') return
    useBoardConfigValuesStore.getState().replace(outcome.updated)
    setPendingPlan(null)
    setPlannedCapturedAtMs(null)
    setNotice('Board config restored.')
  }, [
    boardConfig?.boardId,
    canRevert,
    currentCapturedAtMs,
    pendingPlan,
    plannedCapturedAtMs,
    schemaHash,
  ])

  const revertModal = resolveRevertReviewState({
    plan: pendingPlan,
    selectedBoardId,
    connectedBoardId: boardConfig?.boardId,
    canRevert,
    applyError,
  })

  const { contextLabel: revertContextLabel, contextWarning: revertContextWarning } =
    buildRevertModalCopy(pendingPlan, timeFormat, dateFormat)
  const emptyMessage = resolveHistoryEmptyMessage({
    selectedBoardId,
    loading,
    revisionCount: revisions.length,
    error,
  })

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <HistoryBanners
        error={error}
        notice={notice}
        showOfflineBanner={Boolean(selectedBoardId && revisions.length > 0 && !canRevert)}
        isBoardConnected={isBoardConnected}
      />
      {emptyMessage ? (
        <Text style={styles.empty}>{emptyMessage}</Text>
      ) : (
        <HistoryList
          entries={entries}
          latestRevisionId={latestRevisionId}
          oldestRevisionId={oldestRevisionId}
          expandedSessions={expandedSessions}
          canRevert={canRevert}
          planningRevisionId={planningRevisionId}
          borderColor={neutral.border}
          timeFormat={timeFormat}
          dateFormat={dateFormat}
          temperatureUnit={temperatureUnit}
          resolvedFieldsById={resolvedFieldsById}
          profileNamesById={profileNamesById}
          onToggleSession={handleToggleSession}
          onRevert={(revisionId) => void handlePlanRevert(revisionId)}
        />
      )}

      <BoardConfigReviewModal
        visible={revertModal.visible}
        source="revert"
        boardName={board?.name}
        contextLabel={revertContextLabel}
        contextWarning={revertContextWarning}
        entries={reviewEntries}
        skippedFields={pendingPlan?.skippedFields}
        saving={saving}
        confirmDisabled={revertModal.confirmDisabled}
        error={revertModal.error}
        onConfirm={handleConfirmRevert}
        onCancel={() => {
          if (!saving) {
            setPendingPlan(null)
            setPlannedCapturedAtMs(null)
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
