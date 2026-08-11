import { useCallback, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Favorite, HistoryGpsSample, HistoryMarker } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { ConfirmModal } from '@/components/modals/ConfirmModal'
import { theme } from '@/constants/theme'
import { HistoryEmptyState } from '@/modules/history/components/HistoryEmptyState'
import { HistorySessionSheet } from '@/modules/history/components/HistorySessionSheet'
import { MediaHistoryViewer } from '@/modules/history/components/MediaHistoryViewer'
import type { MediaAssetInput, MediaHistoryAsset } from '@/modules/history/lib/mediaHistory'
import { favoriteSessionId, sessionContainsFavorite } from '@/modules/history/lib/favorites'
import type { HistoryMetricKey } from '@/modules/history/lib/metricColorScale'
import type {
  HistorySession,
  TelemetryMinuteBucket,
  TelemetrySample,
} from '@/modules/history/store/historyStore'
import { HistoryControls } from '@/screens/main/history/HistoryControls'
import { HistoryMapLoading } from '@/screens/main/history/HistoryMapLoading'
import { HistoryRideDetail } from '@/screens/main/history/HistoryRideDetail'
import type { HistoryTab } from '@/screens/main/mainScreenStore'
import { STRIP_CONTENT_HEIGHT } from '@/screens/main/overlays/BottomTelemetryStrip'

export interface MainHistoryOverlayProps {
  selectedSession: HistorySession | null
  sessionSamples: TelemetrySample[]
  sessionGpsSamples: HistoryGpsSample[]
  sessionMarkers: HistoryMarker[]
  nextRide: HistorySession | null
  canPreviousRide: boolean
  loadingSession: boolean
  historyLoading: boolean
  historyHasMore: boolean
  historyError: string | undefined
  blocks: TelemetryMinuteBucket[]
  sessions: HistorySession[]
  historySheetVisible: boolean
  setHistorySheetVisible: (visible: boolean) => void
  historyTab: HistoryTab
  selectHistoryTab: (tab: HistoryTab) => void
  favorites: Favorite[]
  favoritesLoading: boolean
  favoritesSaving: boolean
  favoritesError: string | undefined
  selectedSessionFavorite: Favorite | null
  trimming: boolean
  trimSeed: { startMs: number; endMs: number } | null
  beginTrimFavorite: () => void
  beginEditFavorite: () => Promise<void>
  updateTrimRange: (startMs: number, endMs: number) => void
  cancelTrim: () => Promise<void>
  saveTrim: (name: string) => Promise<void>
  favoriteSessions: HistorySession[]
  canPreviousFavorite: boolean
  canNextFavorite: boolean
  selectPreviousFavorite: () => Promise<void>
  selectNextFavorite: () => Promise<void>
  /** The selected Favorite while the Favorites tab is active. */
  openFavorite: Favorite | null
  selectFavorite: (favorite: Favorite) => Promise<void>
  removeOpenFavorite: () => Promise<void>
  loadMoreHistory: () => Promise<void>
  selectPreviousRide: () => Promise<void>
  selectNextRide: () => Promise<void>
  selectRide: (session: HistorySession) => void
  exitHistory: () => void
  removeSession: () => void
  onSeek: (timeMs: number) => void
  setActiveHistoryMapMetric: (metric: HistoryMetricKey) => void
  mediaHistory: {
    assets: MediaHistoryAsset[]
    unmatched: MediaAssetInput[]
    loading: boolean
    error: string | null
    add: () => Promise<void>
  }
  openMedia: (asset: MediaAssetInput) => void
  openMediaAssetId: string | null
  closeMedia: () => void
}

interface HistoryOverlayProps {
  visible: boolean
  history: MainHistoryOverlayProps
  /** Height of the telemetry panel, so the session sheet and the map vignette sit above it. */
  panelHeight: number
  onPanelHeightChange: (height: number) => void
}

/** History mode: the replayed ride's panel, stats and controls, plus the ride list and media. */
export function HistoryOverlay({
  visible,
  history,
  panelHeight,
  onPanelHeightChange,
}: HistoryOverlayProps) {
  const insets = useSafeAreaInsets()
  const [removeConfirmVisible, setRemoveConfirmVisible] = useState(false)
  const listButtonRef = useRef<View>(null)
  const busy =
    history.loadingSession ||
    history.historyLoading ||
    history.favoritesLoading ||
    history.favoritesSaving
  const aboveStripBottom = STRIP_CONTENT_HEIGHT + Math.max(insets.bottom * 0.5, 8) + 8
  const favoriteMode = history.historyTab === 'favorites'
  const detailSession =
    history.historyTab === 'history' || history.openFavorite ? history.selectedSession : null
  const selectedSessionContainsFavorite =
    history.selectedSession != null &&
    sessionContainsFavorite(history.favorites, history.selectedSession)

  const handleRemoveConfirm = useCallback(() => {
    setRemoveConfirmVisible(false)
    history.removeSession()
  }, [history])

  return (
    <>
      {visible && detailSession && (
        <HistoryRideDetail
          history={history}
          session={detailSession}
          favoriteMode={favoriteMode}
          busy={busy}
          onRemoveSession={() => setRemoveConfirmVisible(true)}
          onPanelHeightChange={onPanelHeightChange}
          listButtonRef={listButtonRef}
        />
      )}

      {visible && !detailSession && (
        <>
          {busy ? <HistoryMapLoading /> : <HistoryEmptyState favoriteMode={favoriteMode} />}
          <HistoryControls
            loading={busy}
            tab={history.historyTab}
            canRemove={false}
            trimming={false}
            saving={false}
            trimName=""
            onTrimNameChange={() => undefined}
            onSelectTab={history.selectHistoryTab}
            onBack={history.exitHistory}
            onRemove={() => undefined}
            onCancelTrim={() => undefined}
            onSaveTrim={() => undefined}
          />
        </>
      )}

      <HistorySessionSheet
        visible={history.historySheetVisible}
        triggerRef={listButtonRef}
        favoriteMode={favoriteMode}
        blocks={history.blocks}
        sessions={favoriteMode ? history.favoriteSessions : history.sessions}
        favorites={favoriteMode ? history.favorites : []}
        selectedSessionId={history.selectedSession?.id ?? null}
        hasMore={!favoriteMode && history.historyHasMore}
        loadingMore={history.historyLoading}
        onClose={() => history.setHistorySheetVisible(false)}
        onSelectSession={(session) => {
          history.setHistorySheetVisible(false)
          if (favoriteMode) {
            const favorite = history.favorites.find(
              (item) => session.id === favoriteSessionId(item.id),
            )
            if (favorite) void history.selectFavorite(favorite)
          } else {
            history.selectRide(session)
          }
        }}
        onLoadMore={() => {
          void history.loadMoreHistory()
        }}
      />

      {visible && (history.historyError ?? history.favoritesError) ? (
        <View style={[styles.historyError, { bottom: aboveStripBottom }]}>
          <Text style={styles.historyErrorText} selectable>
            {history.historyError ?? history.favoritesError}
          </Text>
        </View>
      ) : null}

      {history.openMediaAssetId ? (
        <MediaHistoryViewer
          key={history.openMediaAssetId}
          assets={[...history.mediaHistory.assets, ...history.mediaHistory.unmatched]}
          initialAssetId={history.openMediaAssetId}
          samples={history.sessionSamples}
          markers={history.sessionMarkers}
          onClose={history.closeMedia}
        />
      ) : null}

      <ConfirmModal
        visible={removeConfirmVisible}
        title="Delete Ride"
        message={
          selectedSessionContainsFavorite
            ? 'Favorited telemetry will be kept. The rest of this ride will be permanently removed.'
            : 'This ride and all its telemetry data will be permanently removed.'
        }
        confirmLabel="Delete"
        cancelLabel="Keep"
        destructive
        onConfirm={handleRemoveConfirm}
        onCancel={() => setRemoveConfirmVisible(false)}
      />
    </>
  )
}

const styles = StyleSheet.create({
  historyError: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 25,
    borderRadius: 10,
    padding: 10,
    backgroundColor: theme.status.error.bg,
    borderWidth: 1,
    borderColor: theme.status.error.bg,
  },
  historyErrorText: {
    color: theme.status.error.text,
    fontSize: 12,
    fontWeight: '700',
  },
})
