import { useState } from 'react'

import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ToggleRow } from '@/components/dev/ShowcaseControls'
import { theme } from '@/constants/theme'
import { HistoryRideRow } from '@/modules/history/components/HistoryRideRow'
import type { RoutePoint } from '@/modules/history/lib/routePreview'

const route: RoutePoint[] = [
  { latitude: 52, longitude: 18 },
  { latitude: 52.001, longitude: 18 },
  { latitude: 52.001, longitude: 18.0015 },
  { latitude: 52.0005, longitude: 18.0015 },
]

export function HistoryRideRowShowcase() {
  const [selected, setSelected] = useState(false)
  return (
    <ShowcaseCard
      name="HistoryRideRow"
      controls={<ToggleRow label="selected" value={selected} onToggle={setSelected} />}
    >
      <HistoryRideRow
        title="17:15 – 17:28 · 10 Oct 2026"
        subtitle="13 min · 4.14 km · VESC Board"
        routePoints={route}
        selected={selected}
        onPress={() => undefined}
      />
      <HistoryRideRow
        title="Evening ride"
        subtitle="10 Oct 2026"
        details="4 min · 1.42 km"
        routePoints={route}
        accent={theme.palette.amber.color}
        onPress={() => undefined}
      />
    </ShowcaseCard>
  )
}
