import { useState } from 'react'
import { UserCircleGearIcon } from 'phosphor-react-native'

import { IconButton } from '@/components/base/IconButton'

import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ToggleRow } from '@/components/dev/ShowcaseControls'
import { PublicRideManualAction } from '@/modules/group-ride/components/PublicRideManualAction'
import { PublicRideSelector } from '@/modules/group-ride/components/PublicRideSelector'
import type { PublicRideChoice } from '@/modules/group-ride/lib/publicRide'
import { AccountSignInPill } from '@/modules/profile/components/AccountPill'

/** The public ride switch: off, a number of hours, always; live and unavailable states. */
export function PublicRideSelectorShowcase() {
  const [value, setValue] = useState<PublicRideChoice>({ mode: 'hours', hours: 2 })
  const [live, setLive] = useState(false)
  const [manualSharing, setManualSharing] = useState(false)
  const [settings, setSettings] = useState(true)
  const [setup, setSetup] = useState(false)
  const [disabled, setDisabled] = useState(false)

  return (
    <ShowcaseCard
      name="PublicRideSelector"
      controls={
        <>
          <ToggleRow label="settings action" value={settings} onToggle={setSettings} />
          <ToggleRow label="board sharing live" value={live} onToggle={setLive} />
          <ToggleRow label="sign-in required" value={setup} onToggle={setSetup} />
          <ToggleRow label="disabled" value={disabled} onToggle={setDisabled} />
        </>
      }
    >
      <PublicRideSelector
        value={value}
        live={!setup && (live || manualSharing) && value.mode !== 'off'}
        disabled={disabled || setup}
        headerAction={
          settings && !setup ? (
            <IconButton
              accessibilityLabel="Open Privacy Zones"
              icon={UserCircleGearIcon}
              size="sm"
              onPress={() => {}}
            />
          ) : null
        }
        overlayAction={
          setup ? <AccountSignInPill size="lg" onPress={() => setSetup(false)} /> : null
        }
        onValueChange={(choice) => {
          setValue(choice)
          if (choice.mode === 'off') setManualSharing(false)
        }}
      />
      {!setup && !disabled && value.mode !== 'off' && (manualSharing || !live) ? (
        <PublicRideManualAction sharing={manualSharing} onChange={setManualSharing} />
      ) : null}
    </ShowcaseCard>
  )
}
