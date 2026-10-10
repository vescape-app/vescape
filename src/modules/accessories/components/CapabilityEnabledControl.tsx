import { useState } from 'react'
import type { Icon } from 'phosphor-react-native'
import { setAccessoryCapabilityEnabled, type AccessoryCapability } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { Switch } from '@/components/controls/Switch'
import { capabilityPresentation } from '../constants/accessoryCapabilities'
import { theme, type ThemeColor } from '@/constants/theme'

/** The one switch that decides whether a capability runs at all — always the top of its screen. */
export function CapabilityEnabledControl({
  accessoryId,
  capability,
  accent,
}: {
  accessoryId: string
  capability: AccessoryCapability
  /** Tint of the row, so a light's screen reads in its own colour. */
  accent?: ThemeColor
}) {
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const change = async (enabled: boolean) => {
    setSaving(true)
    setFailed(false)
    try {
      setFailed(!(await setAccessoryCapabilityEnabled(accessoryId, capability.id, enabled)))
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }
  const { title, icon } = capabilityPresentation(capability)
  return (
    <CapabilityEnabledSetting
      icon={icon}
      accent={accent}
      label={`Use ${title.toLowerCase()}`}
      enabled={capability.enabled !== false}
      pending={saving}
      disabled={!capability.supported}
      failed={failed}
      onChange={(enabled) => {
        void change(enabled)
      }}
    />
  )
}

export function CapabilityEnabledSetting({
  icon,
  accent,
  label,
  enabled,
  disabled,
  pending,
  failed,
  onChange,
}: {
  icon: Icon
  accent?: ThemeColor
  label: string
  enabled: boolean
  disabled?: boolean
  /** The write is in flight — the switch spins instead of pretending it already landed. */
  pending?: boolean
  failed?: boolean
  onChange: (enabled: boolean) => void
}) {
  return (
    <>
      <SettingsCard>
        <SettingsRow
          icon={icon}
          {...(accent ? { iconColor: accent } : {})}
          label={label}
          right={
            <Switch
              value={enabled}
              onValueChange={onChange}
              {...(disabled ? { disabled } : {})}
              {...(pending ? { pending } : {})}
              accessibilityLabel={label}
            />
          }
        />
      </SettingsCard>
      {failed ? (
        <Text style={{ color: theme.status.caution.text }}>Could not save. Try again.</Text>
      ) : null}
    </>
  )
}
