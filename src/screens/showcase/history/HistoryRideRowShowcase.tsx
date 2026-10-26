import { useState } from 'react'

import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ToggleRow } from '@/components/dev/ShowcaseControls'
import { theme } from '@/constants/theme'
import { HistoryRideRow, HistoryRideRowSkeleton } from '@/modules/history/components/HistoryRideRow'
import type { RoutePoint } from '@/modules/history/lib/routePreview'

const route: RoutePoint[] = [
  { latitude: 52, longitude: 18 },
  { latitude: 52.001, longitude: 18 },
  { latitude: 52.001, longitude: 18.0015 },
  { latitude: 52.0005, longitude: 18.0015 },
]

export function HistoryRideRowShowcase() {
  const [selected, setSelected] = useState(false)
  const [loading, setLoading] = useState(false)
  const [weather, setWeather] = useState(true)
  return (
    <ShowcaseCard
      name="HistoryRideRow"
      controls={
        <>
          <ToggleRow label="selected" value={selected} onToggle={setSelected} />
          <ToggleRow label="loading" value={loading} onToggle={setLoading} />
          <ToggleRow label="weather" value={weather} onToggle={setWeather} />
        </>
      }
    >
      {loading ? (
        <HistoryRideRowSkeleton />
      ) : (
        <HistoryRideRow
          title="17:15 – 17:28"
          subtitle="13 min · 4.14 km · VESC Board"
          routePoints={route}
          selected={selected}
          weather={
            weather
              ? {
                  icon: 'cloud-sun',
                  minTemperatureC: 8,
                  maxTemperatureC: 20,
                  maxGustKmh: 35,
                  rainMinutes: 0,
                }
              : null
          }
          onPress={() => undefined}
        />
      )}
      {loading ? (
        <HistoryRideRowSkeleton />
      ) : (
        <HistoryRideRow
          title="Evening ride"
          subtitle="18:05 – 18:09"
          details="4 min · 1.42 km"
          routePoints={route}
          selected={selected}
          accent={theme.palette.amber.color}
          weather={
            weather
              ? {
                  icon: 'cloud-rain',
                  minTemperatureC: 13,
                  maxTemperatureC: 14,
                  maxGustKmh: 40,
                  rainMinutes: 12,
                }
              : null
          }
          onPress={() => undefined}
        />
      )}
    </ShowcaseCard>
  )
}
