import { useState } from 'react'
import { setAccessoryCapabilityEnabled, type AccessoryCapability } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { SwitchWidget } from '@/components/widgets/SwitchWidget'
import { capabilityPresentation } from '../constants/accessoryCapabilities'
import { theme } from '@/constants/theme'

export function CapabilityEnabledControl({
  accessoryId,
  capability,
}: {
  accessoryId: string
  capability: AccessoryCapability
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
  return (
    <CapabilityEnabledSetting
      label={`Use ${capabilityPresentation(capability).title.toLowerCase()}`}
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
  label,
  enabled,
  disabled,
  failed,
  onChange,
}: {
  label: string
  enabled: boolean
  disabled?: boolean
  failed?: boolean
  onChange: (enabled: boolean) => void
}) {
  return (
    <>
      <SwitchWidget
        label={label}
        value={enabled}
        onValueChange={onChange}
        disabled={disabled}
        hint="Turning this off keeps your settings."
      />
      {failed ? (
        <Text style={{ color: theme.status.caution.text }}>Could not save. Try again.</Text>
      ) : null}
    </>
  )
}
