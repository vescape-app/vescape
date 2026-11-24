import { useState } from 'react'
import { UserCircleGearIcon } from 'phosphor-react-native'
import type { PublicRideStatus } from 'vescape-core'

import { IconButton } from '@/components/base/IconButton'

import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ToggleRow } from '@/components/dev/ShowcaseControls'
import { PublicRideManualAction } from '@/modules/group-ride/components/PublicRideManualAction'
import { PublicRideSelector } from '@/modules/group-ride/components/PublicRideSelector'
import {
  publicRidePresetEnds,
  publicRideTimeLeft,
  type PublicRideChoice,
} from '@/modules/group-ride/lib/publicRide'
import { AccountSignInPill } from '@/modules/profile/components/AccountPill'

export function PublicRideSelectorShowcase() {
  const [value, setValue] = useState<PublicRideChoice>({ mode: 'off' })
  const [boardConnected, setBoardConnected] = useState(false)
  const [relayConfirmed, setRelayConfirmed] = useState(true)
  const [manualSharing, setManualSharing] = useState(false)
  const [settings, setSettings] = useState(true)
  const [setup, setSetup] = useState(false)
  const [notice, setNotice] = useState(false)
  const [disabled, setDisabled] = useState(false)
  const [running, setRunning] = useState(true)
  const [presetEnds] = useState(() => publicRidePresetEnds(Date.now(), '24h'))

  const activation: PublicRideStatus['activation'] =
    setup || value.mode === 'off'
      ? 'off'
      : boardConnected
        ? 'board'
        : manualSharing
          ? 'phone'
          : 'waiting'
  const live = relayConfirmed && (activation === 'board' || activation === 'phone')

  return (
    <ShowcaseCard
      name="PublicRideSelector"
      controls={
        <>
          <ToggleRow label="settings action" value={settings} onToggle={setSettings} />
          <ToggleRow
            label="board connected"
            value={boardConnected}
            onToggle={(connected) => {
              setBoardConnected(connected)
              if (connected) setManualSharing(false)
            }}
          />
          <ToggleRow label="relay confirmed" value={relayConfirmed} onToggle={setRelayConfirmed} />
          <ToggleRow label="sign-in required" value={setup} onToggle={setSetup} />
          <ToggleRow label="disabled" value={disabled} onToggle={setDisabled} />
          <ToggleRow label="notice" value={notice} onToggle={setNotice} />
          <ToggleRow label="timer running" value={running} onToggle={setRunning} />
        </>
      }
    >
      <PublicRideSelector
        value={value}
        activation={activation}
        live={live}
        boardConnected={boardConnected}
        notice={notice ? 'Loading your rider profile…' : null}
        running={
          running && value.mode === 'hours'
            ? {
                hours: value.hours,
                left: publicRideTimeLeft(value.hours * 3_600_000 - 1_080_000, 0) ?? '',
                end: '15:42',
              }
            : null
        }
        presetEnds={presetEnds}
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
      {!disabled && (activation === 'waiting' || activation === 'phone') ? (
        <PublicRideManualAction activation={activation} onChange={setManualSharing} />
      ) : null}
    </ShowcaseCard>
  )
}
