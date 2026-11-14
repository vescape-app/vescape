import { PageScrollView } from '@/components/base/PageScrollView'
import { StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useState } from 'react'
import { ClockCounterClockwiseIcon } from 'phosphor-react-native'

import { IconHero } from '@/components/settings/IconHero'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ToggleRow } from '@/components/dev/ShowcaseControls'
import { theme } from '@/constants/theme'
import { RouteSparkline } from '@/modules/history/components/RouteSparkline'
import { RidePreviewCard } from '@/modules/history/components/RidePreviewCard'
import {
  RidePreviewStrip,
  RidePreviewStripSkeleton,
} from '@/modules/history/components/RidePreviewCardList'
import type { RoutePoint } from '@/modules/history/lib/routePreview'
import { HistoryRideRowShowcase } from '@/screens/showcase/history/HistoryRideRowShowcase'

const PREVIEW_ROUTES: Record<string, RoutePoint[]> = {
  corners: [
    { latitude: 52, longitude: 18 },
    { latitude: 52.001, longitude: 18 },
    { latitude: 52.001, longitude: 18.0015 },
    { latitude: 52.0005, longitude: 18.0015 },
    { latitude: 52.0005, longitude: 18.002 },
  ],
  straight: [
    { latitude: 52, longitude: 18 },
    { latitude: 52, longitude: 18.002 },
  ],
  gap: [
    { latitude: 52, longitude: 18 },
    { latitude: 52.001, longitude: 18 },
    { latitude: 52.001, longitude: 18.0015, breakBefore: true },
    { latitude: 52.0005, longitude: 18.0015 },
  ],
  empty: [],
}

function RouteSparklineShowcase() {
  const [route, setRoute] = useState('corners')
  const [endpoints, setEndpoints] = useState(true)
  const [map, setMap] = useState(false)
  return (
    <ShowcaseCard
      name="RouteSparkline"
      controls={
        <>
          <ChipRow
            label="route"
            options={Object.keys(PREVIEW_ROUTES)}
            selected={route}
            onSelect={setRoute}
          />
          <ToggleRow label="endpoints" value={endpoints} onToggle={setEndpoints} />
          <ToggleRow label="map" value={map} onToggle={setMap} />
        </>
      }
    >
      <RouteSparkline
        points={PREVIEW_ROUTES[route]}
        width={74}
        height={52}
        endpoints={endpoints}
        map={map}
      />
      <RouteSparkline
        points={PREVIEW_ROUTES[route]}
        width={148}
        height={104}
        endpoints={endpoints}
        map={map}
      />
    </ShowcaseCard>
  )
}

function RidePreviewCardShowcase() {
  const [route, setRoute] = useState('corners')
  const [loading, setLoading] = useState(false)
  return (
    <ShowcaseCard
      name="RidePreviewCard · RidePreviewStrip"
      controls={
        <>
          <ToggleRow label="loading" value={loading} onToggle={setLoading} />
          <ChipRow
            label="route"
            options={Object.keys(PREVIEW_ROUTES)}
            selected={route}
            onSelect={setRoute}
          />
        </>
      }
    >
      {loading ? (
        <RidePreviewStripSkeleton bleed={0} accessibilityLabel="Loading rides" />
      ) : (
        <RidePreviewStrip bleed={0}>
          <RidePreviewCard
            title="15:29 – 15:30"
            date="11 Sep 2026"
            subtitle="1 min · 0.80 km · 23 km/h"
            routePoints={PREVIEW_ROUTES[route]}
            color={theme.palette.purple.color}
            map={false}
            weather={{
              icon: 'cloud',
              minTemperatureC: 8,
              maxTemperatureC: 20,
              maxGustKmh: 30,
              rainMinutes: 0,
            }}
            onPress={() => undefined}
          />
          <RidePreviewCard
            title="Evening ride"
            date="10 Oct 2026"
            subtitle="12 min · 3.45 km"
            routePoints={PREVIEW_ROUTES[route]}
            color={theme.palette.amber.color}
            map={false}
            onPress={() => undefined}
          />
          <RidePreviewCard
            title="Morning loop"
            date="9 Oct 2026"
            subtitle="25 min · 7.10 km"
            routePoints={PREVIEW_ROUTES[route]}
            color={theme.palette.purple.color}
            map={false}
            onPress={() => undefined}
          />
        </RidePreviewStrip>
      )}
    </ShowcaseCard>
  )
}

export default function HistoryComponentsPage() {
  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <PageScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={ClockCounterClockwiseIcon}
          description="RouteSparkline, RidePreviewCard, RidePreviewStrip, HistoryRideRow."
        />
        <RidePreviewCardShowcase />
        <RouteSparklineShowcase />
        <HistoryRideRowShowcase />
      </PageScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
})
