import { useCallback, useMemo, useRef, useState, type RefObject } from 'react'
import { StyleSheet, View } from 'react-native'

import { ExportIcon, TrashIcon } from 'phosphor-react-native'
import { Button } from '@/components/base/Button'
import { theme } from '@/constants/theme'
import { FadeCardModal } from '@/components/modals/FadeCardModal'
import { InfoModal } from '@/components/modals/InfoModal'
import { rideExportOptions } from '@/modules/history/lib/rideExport'
import { shareRideExport } from '@/modules/history/lib/shareRideExport'
import { ConfirmModal } from '@/components/modals/ConfirmModal'
import {
  formatFavoriteName,
  formatRideTime,
  suggestFavoriteName,
} from '@/modules/history/lib/rideFormat'
import type { HistorySession } from '@/modules/history/store/historyStore'
import { HistoryControls } from '@/screens/main/history/HistoryControls'
import { HistoryTelemetryPanel } from '@/screens/main/history/HistoryTelemetryPanel'
import { RangeStatsBar } from '@/screens/main/history/RangeStatsBar'
import type { MainHistoryOverlayProps } from '@/screens/main/history/HistoryOverlay'

interface HistoryRideDetailProps {
  history: MainHistoryOverlayProps
  /** The ride being replayed: a grouped history session, or a favorite-backed one. */
  session: HistorySession
  /**
   * Favorite detail rather than a history ride: the header carries the Favorite's name, rename and
   * delete, and the ride-only affordances (prev/next, star, trim, ride delete) are gone.
   */
  favoriteMode: boolean
  busy: boolean
  onRemoveSession: () => void
  onPanelHeightChange: (height: number) => void
  listButtonRef: RefObject<View | null>
}

/** Stable identity: a Favorite has no Favorite ranges drawn over it, and a fresh [] re-renders. */
const NO_FAVORITE_RANGES: { startMs: number; endMs: number }[] = []

/** The replayed ride: chart panel, stats and header. Shared by history mode and favorite mode. */
export function HistoryRideDetail({
  history,
  session,
  favoriteMode,
  busy,
  onRemoveSession,
  onPanelHeightChange,
  listButtonRef,
}: HistoryRideDetailProps) {
  const [deleteVisible, setDeleteVisible] = useState(false)
  const [trimName, setTrimName] = useState('')
  const [actionsVisible, setActionsVisible] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const pendingAction = useRef<(() => void) | null>(null)
  const afterActionsDismissed = () => {
    const action = pendingAction.current
    pendingAction.current = null
    action?.()
  }
  const dismissForAction = (action: () => void) => {
    pendingAction.current = action
    setActionsVisible(false)
  }
  const openFavorite = favoriteMode ? history.openFavorite : null
  const trimming = history.trimming

  // Stable handlers, so the panel — which rebuilds every chart series it is handed — re-renders
  // when the ride changes rather than every time this screen does.
  const {
    selectPreviousFavorite,
    selectPreviousRide,
    selectNextFavorite,
    selectNextRide,
    setHistorySheetVisible,
    beginTrimFavorite,
  } = history
  const mediaAdd = history.mediaHistory.add
  const handlePrevious = useCallback(() => {
    void (favoriteMode ? selectPreviousFavorite() : selectPreviousRide())
  }, [favoriteMode, selectPreviousFavorite, selectPreviousRide])
  const handleNext = useCallback(() => {
    void (favoriteMode ? selectNextFavorite() : selectNextRide())
  }, [favoriteMode, selectNextFavorite, selectNextRide])
  const handleOpenList = useCallback(() => setHistorySheetVisible(true), [setHistorySheetVisible])
  const handleAddMedia = useCallback(() => void mediaAdd(), [mediaAdd])
  const handleToggleFavorite = useCallback(() => {
    setTrimName('')
    beginTrimFavorite()
  }, [beginTrimFavorite])
  const trimSeedStartMs = history.trimSeed?.startMs
  const trimSeedEndMs = history.trimSeed?.endMs
  const updateTrimRange = history.updateTrimRange
  const trimConfig = useMemo(
    () =>
      trimming && trimSeedStartMs != null && trimSeedEndMs != null
        ? {
            startMs: trimSeedStartMs,
            endMs: trimSeedEndMs,
            onChange: updateTrimRange,
            onCommit: updateTrimRange,
          }
        : undefined,
    [trimSeedEndMs, trimSeedStartMs, trimming, updateTrimRange],
  )

  return (
    <>
      <HistoryTelemetryPanel
        startAtMs={session.startAtMs}
        endAtMs={session.endAtMs}
        movingStartAtMs={session.movingStartAtMs}
        movingEndAtMs={session.movingEndAtMs}
        boardName={session.boardName}
        navigationTitle={
          openFavorite
            ? formatFavoriteName(openFavorite.name, openFavorite.startMs, openFavorite.endMs)
            : undefined
        }
        navigationSubtitle={
          openFavorite
            ? [formatRideTime(openFavorite.startMs, openFavorite.endMs), openFavorite.boardName]
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
        gpsGapSamples={history.sessionSamples}
        samples={history.sessionChartSamples}
        canPrevious={
          !trimming && (favoriteMode ? history.canPreviousFavorite : history.canPreviousRide)
        }
        canNext={!trimming && (favoriteMode ? history.canNextFavorite : history.nextRide != null)}
        favoriteMode={favoriteMode}
        favoriteRanges={favoriteMode ? NO_FAVORITE_RANGES : history.favorites}
        favorited={history.selectedSessionFavorite != null}
        actionDisabled={busy || history.favoritesSaving}
        mediaAssets={history.mediaHistory.assets}
        mediaUnmatched={history.mediaHistory.unmatched}
        mediaLoading={history.mediaHistory.loading}
        mediaError={history.mediaHistory.error}
        listButtonRef={listButtonRef}
        onPrevious={handlePrevious}
        onNext={handleNext}
        onOpenList={handleOpenList}
        onAddMedia={handleAddMedia}
        onOpenMedia={history.openMedia}
        onToggleFavorite={handleToggleFavorite}
        onMetricInteraction={history.setActiveHistoryMapMetric}
        onHeightChange={onPanelHeightChange}
        trim={trimConfig}
      />
      <RangeStatsBar
        session={session}
        samples={history.sessionSamples}
        gpsSamples={history.sessionGpsSamples}
        trimming={trimming}
      />
      <HistoryControls
        loading={busy}
        tab={history.historyTab}
        canRemove={!favoriteMode}
        trimming={trimming}
        saving={history.favoritesSaving}
        trimName={trimName}
        trimNamePlaceholder={
          history.trimSeed
            ? suggestFavoriteName(history.trimSeed.startMs, history.trimSeed.endMs)
            : 'Favorite name'
        }
        onTrimNameChange={setTrimName}
        favorite={
          openFavorite
            ? {
                onEdit: () => {
                  setTrimName(openFavorite.name ?? '')
                  void history.beginEditFavorite()
                },
              }
            : undefined
        }
        onSelectTab={history.selectHistoryTab}
        onBack={history.exitHistory}
        onOpenActions={() => setActionsVisible(true)}
        onCancelTrim={() => {
          setTrimName('')
          void history.cancelTrim()
        }}
        onSaveTrim={() => {
          void history.saveTrim(trimName)
        }}
      />

      <FadeCardModal
        visible={actionsVisible}
        title={openFavorite ? 'Favorite actions' : 'Ride actions'}
        onDismiss={() => setActionsVisible(false)}
        onDismissed={afterActionsDismissed}
        scrollable={false}
      >
        {(['gpx', 'csv'] as const).map((format) => (
          <Button
            key={format}
            label={`Export ${format.toUpperCase()}`}
            icon={ExportIcon}
            variant="secondary"
            loading={exporting}
            onPress={() => {
              const options = rideExportOptions(session, openFavorite)
              dismissForAction(() => {
                setExporting(true)
                void shareRideExport(options, format)
                  .catch((cause: unknown) =>
                    setExportError(
                      cause instanceof Error ? cause.message : 'Could not export ride',
                    ),
                  )
                  .finally(() => setExporting(false))
              })
            }}
          />
        ))}
        <View
          style={{
            height: StyleSheet.hairlineWidth,
            width: '40%',
            alignSelf: 'center',
            marginVertical: 8,
            backgroundColor: theme.neutral.border,
          }}
        />
        <Button
          label="Delete"
          icon={TrashIcon}
          variant="destructive"
          disabled={busy}
          testID={openFavorite ? 'favorite-delete' : 'history-delete'}
          onPress={() =>
            dismissForAction(openFavorite ? () => setDeleteVisible(true) : onRemoveSession)
          }
        />
      </FadeCardModal>
      <InfoModal
        visible={exportError != null}
        title="Export failed"
        message={exportError ?? ''}
        variant="danger"
        onDismiss={() => setExportError(null)}
      />
      <ConfirmModal
        visible={deleteVisible}
        title="Delete Favorite"
        message="The Favorite is removed. Its telemetry stays in history and becomes deletable again."
        confirmLabel="Delete"
        cancelLabel="Keep"
        destructive
        onConfirm={() => {
          setDeleteVisible(false)
          void history.removeOpenFavorite()
        }}
        onCancel={() => setDeleteVisible(false)}
      />
    </>
  )
}
