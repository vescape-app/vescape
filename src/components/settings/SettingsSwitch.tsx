import { Switch } from 'react-native'

import { theme } from '@/constants/theme'
import { useResolvedColor, useResolvedNeutralColors } from '@/hooks/useTheme'

export interface SettingsSwitchProps {
  value: boolean
  onValueChange: (value: boolean) => void
  /** Tint of the active track and thumb, so a capability reads in its own colour. */
  accent?: string
  disabled?: boolean
  accessibilityLabel?: string
  testID?: string
}

/** The switch a `SettingsRow` puts on its trailing edge. One tint rule for every settings screen. */
export function SettingsSwitch({
  value,
  onValueChange,
  accent = theme.palette.sky.color,
  disabled,
  accessibilityLabel,
  testID,
}: SettingsSwitchProps) {
  const neutral = useResolvedNeutralColors()
  const resolvedAccent = useResolvedColor(accent)

  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: neutral.border, true: theme.alpha(resolvedAccent, 0.6) }}
      thumbColor={value ? resolvedAccent : neutral.textMuted}
      ios_backgroundColor={neutral.border}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    />
  )
}
