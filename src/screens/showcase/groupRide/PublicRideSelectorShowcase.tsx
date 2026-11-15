import { useState } from 'react'
import { GearSixIcon } from 'phosphor-react-native'

import { IconButton } from '@/components/base/IconButton'

import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ToggleRow } from '@/components/dev/ShowcaseControls'
import { PublicRideSelector } from '@/modules/group-ride/components/PublicRideSelector'
import type { PublicRideChoice } from '@/modules/group-ride/lib/publicRide'
import { AccountSignInPill } from '@/modules/profile/components/AccountPill'

/** The public ride switch: off, a number of hours, always; live and unavailable states. */
export function PublicRideSelectorShowcase() {
  const [value, setValue] = useState<PublicRideChoice>({ mode: 'hours', hours: 2 })
  const [live, setLive] = useState(false)
  const [settings, setSettings] = useState(true)
  const [setup, setSetup] = useState(false)
  const [disabled, setDisabled] = useState(false)

  return (
    <ShowcaseCard
      name="PublicRideSelector"
      controls={
        <>
          <ToggleRow label="settings action" value={settings} onToggle={setSettings} />
          <ToggleRow label="live" value={live} onToggle={setLive} />
          <ToggleRow label="sign-in required" value={setup} onToggle={setSetup} />
          <ToggleRow label="disabled" value={disabled} onToggle={setDisabled} />
        </>
      }
    >
      <PublicRideSelector
        value={value}
        live={!setup && live && value.mode !== 'off'}
        disabled={disabled || setup}
        headerAction={
          settings && !setup ? (
            <IconButton
              accessibilityLabel="Open Privacy Zones"
              icon={GearSixIcon}
              size="sm"
              onPress={() => {}}
            />
          ) : null
        }
        overlayAction={
          setup ? <AccountSignInPill size="lg" onPress={() => setSetup(false)} /> : null
        }
        onValueChange={setValue}
      />
    </ShowcaseCard>
  )
}
