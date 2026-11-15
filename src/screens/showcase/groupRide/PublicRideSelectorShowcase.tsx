import { useState } from 'react'

import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ToggleRow } from '@/components/dev/ShowcaseControls'
import { PublicRideSelector } from '@/modules/group-ride/components/PublicRideSelector'
import type { PublicRideChoice } from '@/modules/group-ride/lib/publicRide'

/** The public ride switch: off, a number of hours, always; live and unavailable states. */
export function PublicRideSelectorShowcase() {
  const [value, setValue] = useState<PublicRideChoice>({ mode: 'hours', hours: 2 })
  const [live, setLive] = useState(false)
  const [disabled, setDisabled] = useState(false)

  return (
    <ShowcaseCard
      name="PublicRideSelector"
      controls={
        <>
          <ToggleRow label="live" value={live} onToggle={setLive} />
          <ToggleRow label="disabled" value={disabled} onToggle={setDisabled} />
        </>
      }
    >
      <PublicRideSelector
        value={value}
        live={live && value.mode !== 'off'}
        disabled={disabled}
        onValueChange={setValue}
      />
    </ShowcaseCard>
  )
}
