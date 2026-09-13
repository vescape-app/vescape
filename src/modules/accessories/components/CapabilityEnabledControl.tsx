import { useState } from 'react'
import type { Icon } from 'phosphor-react-native'
import { setAccessoryCapabilityEnabled, type AccessoryCapability } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { SwitchWidget } from '@/components/widgets/SwitchWidget'
import { capabilityPresentation } from '../constants/accessoryCapabilities'
import { theme } from '@/constants/theme'

/** The one switch that decides whether a capability runs at all — always the top of its screen. */
export function CapabilityEnabledControl({
  accessoryId,
  capability,
  accent,
}: {
  accessoryId: string
  capability: AccessoryCapability
  /** Tint of the switch, so a light's screen reads in its own colour. */
  accent?: string
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
      disabled={saving || !capability.supported}
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
  failed,
  onChange,
}: {
  icon?: Icon
  accent?: string
  label: string
  enabled: boolean
  disabled?: boolean
  failed?: boolean
  onChange: (enabled: boolean) => void
}) {
  return (
    <>
      <SwitchWidget
        icon={icon}
        accent={accent}
        label={label}
        value={enabled}
        onValueChange={onChange}
        disabled={disabled}
        hint={
          enabled ? 'Turning this off keeps your settings.' : 'Switched off. Settings are kept.'
        }
      />
      {failed ? (
        <Text style={{ color: theme.status.caution.text }}>Could not save. Try again.</Text>
      ) : null}
    </>
  )
}
