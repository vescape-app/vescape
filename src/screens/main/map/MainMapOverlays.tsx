import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { InfoModal } from '@/components/modals/InfoModal'
import { theme } from '@/constants/theme'
import { LegalLimitCountrySheet } from '@/modules/legal/components/LegalLimitCountrySheet'
import type { LegalLimitCountry } from '@/modules/legal/lib/legalLimits'
import {
  HISTORY_MARKER_LABELS,
  buildHistoryMarkerMessage,
  type SelectedHistoryMarker,
} from '@/modules/history/lib/historyMapMarkerInfo'
import {
  OffscreenMapIndicator,
  type OffscreenMapIndicatorState,
} from '@/screens/main/map/offscreenMapIndicators'

const EDGE_GUARD_WIDTH = 40

export function MainMapOverlays({
  selectedHistoryMarker,
  selectedLegalCountry,
  legalLimitsActive,
  weatherActive,
  showOffscreenIndicators,
  offscreenMapIndicators,
  onDismissHistoryMarker,
  onCloseLegalCountry,
  onOffscreenIndicatorPress,
}: {
  selectedHistoryMarker: SelectedHistoryMarker | null
  selectedLegalCountry: LegalLimitCountry | null
  legalLimitsActive: boolean
  weatherActive: boolean
  showOffscreenIndicators: boolean
  offscreenMapIndicators: OffscreenMapIndicatorState[]
  onDismissHistoryMarker: () => void
  onCloseLegalCountry: () => void
  onOffscreenIndicatorPress: (indicator: OffscreenMapIndicatorState) => void
}) {
  return (
    <>
      <InfoModal
        visible={selectedHistoryMarker != null}
        title={
          selectedHistoryMarker
            ? HISTORY_MARKER_LABELS[selectedHistoryMarker.marker.type]
            : 'History marker'
        }
        message={selectedHistoryMarker ? buildHistoryMarkerMessage(selectedHistoryMarker) : ''}
        dismissLabel="Close"
        onDismiss={onDismissHistoryMarker}
      />
      <LegalLimitCountrySheet
        country={legalLimitsActive ? selectedLegalCountry : null}
        onClose={onCloseLegalCountry}
      />
      {weatherActive ? (
        <Text style={styles.radarAttribution} pointerEvents="none">
          Weather data by RainViewer
        </Text>
      ) : null}
      {showOffscreenIndicators
        ? offscreenMapIndicators.map((indicator) => (
            <OffscreenMapIndicator
              key={indicator.id}
              indicator={indicator}
              onPress={() => onOffscreenIndicatorPress(indicator)}
            />
          ))
        : null}
      <View style={styles.edgeGuardLeft} pointerEvents="box-only" />
      <View style={styles.edgeGuardRight} pointerEvents="box-only" />
    </>
  )
}

export function MapUnavailable() {
  return (
    <View style={styles.unavailable}>
      <Text style={styles.unavailableTitle}>Map unavailable</Text>
      <Text style={styles.unavailableMessage}>
        Set EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN and rebuild the app.
      </Text>
    </View>
  )
}

export function MapLoadingPlaceholder() {
  return <View style={styles.loading} />
}

const styles = StyleSheet.create({
  edgeGuardLeft: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: EDGE_GUARD_WIDTH,
    backgroundColor: theme.alpha(theme.palette.mono.black, 0),
    zIndex: 3,
  },
  edgeGuardRight: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: EDGE_GUARD_WIDTH,
    backgroundColor: theme.alpha(theme.palette.mono.black, 0),
    zIndex: 3,
  },
  radarAttribution: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    color: theme.alpha(theme.palette.mono.white, 0.6),
    fontSize: 10,
    fontWeight: '500',
    backgroundColor: theme.alpha(theme.palette.mono.black, 0.3),
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  unavailable: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.neutral.bg,
    paddingHorizontal: 28,
    gap: 8,
  },
  unavailableTitle: {
    color: theme.neutral.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  unavailableMessage: {
    color: theme.neutral.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  loading: {
    ...StyleSheet.absoluteFill,
  },
})
