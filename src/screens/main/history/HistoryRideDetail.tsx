import { useState, type RefObject } from 'react'
import type { View } from 'react-native'

import { ConfirmModal } from '@/components/modals/ConfirmModal'
import {
  formatFavoriteName,
  formatRideTime,
  suggestFavoriteName,
} from '@/modules/history/lib/rideFormat'
import type { HistorySession } from '@/modules/history/store/historyStore'
import { HistoryControls } from '@/screens/main/history/HistoryControls'
import { HistoryStatsBar } from '@/screens/main/history/HistoryStatsBar'
import { HistoryTelemetryPanel } from '@/screens/main/history/HistoryTelemetryPanel'
import { TrimStatsBar } from '@/screens/main/history/TrimStatsBar'
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
  const openFavorite = favoriteMode ? history.openFavorite : null
  const trimming = history.trimming

  return (
    <>
      <HistoryTelemetryPanel
        startAtMs={session.startAtMs}
        endAtMs={session.endAtMs}
        movingStartAtMs={session.movingStartAtMs}
        movingEndAtMs={session.movingEndAtMs}
        deviceName={session.deviceName}
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
        samples={history.sessionChartSamples}
        canPrevious={
          !trimming && (favoriteMode ? history.canPreviousFavorite : history.canPreviousRide)
        }
        canNext={!trimming && (favoriteMode ? history.canNextFavorite : history.nextRide != null)}
        favoriteMode={favoriteMode}
        favoriteRanges={favoriteMode ? [] : history.favorites}
        favorited={history.selectedSessionFavorite != null}
        actionDisabled={busy || history.favoritesSaving}
        mediaAssets={history.mediaHistory.assets}
        mediaUnmatched={history.mediaHistory.unmatched}
        mediaLoading={history.mediaHistory.loading}
        mediaError={history.mediaHistory.error}
        listButtonRef={listButtonRef}
        onPrevious={() => {
          void (favoriteMode ? history.selectPreviousFavorite() : history.selectPreviousRide())
        }}
        onNext={() => {
          void (favoriteMode ? history.selectNextFavorite() : history.selectNextRide())
        }}
        onOpenList={() => history.setHistorySheetVisible(true)}
        onAddMedia={() => void history.mediaHistory.add()}
        onOpenMedia={history.openMedia}
        onToggleFavorite={() => {
          setTrimName('')
          history.beginTrimFavorite()
        }}
        onMetricInteraction={history.setActiveHistoryMapMetric}
        onHeightChange={onPanelHeightChange}
        trim={
          trimming && history.trimSeed
            ? {
                startMs: history.trimSeed.startMs,
                endMs: history.trimSeed.endMs,
                onChange: history.updateTrimRange,
                onCommit: history.updateTrimRange,
              }
            : undefined
        }
      />
      {trimming ? (
        <TrimStatsBar
          session={session}
          samples={history.sessionSamples}
          gpsSamples={history.sessionGpsSamples}
        />
      ) : (
        <HistoryStatsBar session={session} />
      )}
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
                onDelete: () => setDeleteVisible(true),
              }
            : undefined
        }
        onSelectTab={history.selectHistoryTab}
        onBack={history.exitHistory}
        onRemove={onRemoveSession}
        onCancelTrim={() => {
          setTrimName('')
          void history.cancelTrim()
        }}
        onSaveTrim={() => {
          void history.saveTrim(trimName)
        }}
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
