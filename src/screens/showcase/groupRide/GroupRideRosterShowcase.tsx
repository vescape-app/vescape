import { useState } from 'react'
import { Alert } from 'react-native'
import { BroadcastIcon } from 'phosphor-react-native'

import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ToggleRow } from '@/components/dev/ShowcaseControls'
import { CanvasWidget } from '@/components/widgets/CanvasWidget'
import { theme } from '@/constants/theme'
import { RosterList } from '@/modules/group-ride/components/GroupRideRoster'
import { FIXTURE_OWN_LOCATION, FIXTURE_ROSTER_ROWS } from '@/screens/showcase/mapShowcaseFixtures'

const RIDER_COUNTS = ['1', '3', 'all']

/** The Social sheet roster: own row, live, hot telemetry, stale and away Riders. */
export function GroupRideRosterShowcase() {
  const [count, setCount] = useState('all')
  const [compact, setCompact] = useState(true)
  const [located, setLocated] = useState(true)
  const [selfTelemetry, setSelfTelemetry] = useState(false)
  const selectedRows =
    count === 'all' ? FIXTURE_ROSTER_ROWS : FIXTURE_ROSTER_ROWS.slice(0, Number(count))
  const rows = selfTelemetry
    ? selectedRows
    : selectedRows.map((row) => (row.isSelf ? { ...row, presence: null } : row))

  return (
    <ShowcaseCard
      name="RosterList"
      controls={
        <>
          <ChipRow label="riders" options={RIDER_COUNTS} selected={count} onSelect={setCount} />
          <ToggleRow label="compact" value={compact} onToggle={setCompact} />
          <ToggleRow label="own telemetry" value={selfTelemetry} onToggle={setSelfTelemetry} />
          <ToggleRow label="own location" value={located} onToggle={setLocated} />
        </>
      }
    >
      <CanvasWidget
        icon={BroadcastIcon}
        title="Sunset cruise"
        accent={theme.palette.groupRide.color}
        surface="secondary"
        active
      >
        <RosterList
          compact={compact}
          selfSharing
          onOpenRider={compact ? (rider) => Alert.alert(rider.name) : undefined}
          selfCanOpen
          rows={rows}
          ownLocation={located ? FIXTURE_OWN_LOCATION : null}
        />
      </CanvasWidget>
    </ShowcaseCard>
  )
}
