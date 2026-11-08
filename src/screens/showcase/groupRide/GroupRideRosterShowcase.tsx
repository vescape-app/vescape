import { useState } from 'react'
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
  const [located, setLocated] = useState(true)
  const rows = count === 'all' ? FIXTURE_ROSTER_ROWS : FIXTURE_ROSTER_ROWS.slice(0, Number(count))

  return (
    <ShowcaseCard
      name="RosterList"
      controls={
        <>
          <ChipRow label="riders" options={RIDER_COUNTS} selected={count} onSelect={setCount} />
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
        <RosterList rows={rows} ownLocation={located ? FIXTURE_OWN_LOCATION : null} />
      </CanvasWidget>
    </ShowcaseCard>
  )
}
