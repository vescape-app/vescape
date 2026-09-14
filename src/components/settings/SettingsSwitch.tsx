import { Switch } from 'react-native'

import { theme } from '@/constants/theme'

/** Enough of an accent to tint a switch: every palette hue and every `theme.status` token fits. */
export interface SettingsSwitchAccent {
  color: string
  border: string
}

export interface SettingsSwitchProps {
  value: boolean
  onValueChange: (value: boolean) => void
  /** Tint of the on state, so a row can read in its own colour. */
  accent?: SettingsSwitchAccent
  disabled?: boolean
  accessibilityLabel?: string
  testID?: string
}

/**
 * The switch a `SettingsRow` puts on its trailing edge. One tint rule for every settings screen.
 *
 * A disabled switch drops its accent entirely rather than dimming it: a switch that still shows
 * its on colour while refusing taps reads as broken, not as locked.
 */
export function SettingsSwitch({
  value,
  onValueChange,
  accent = theme.palette.sky,
  disabled,
  accessibilityLabel,
  testID,
}: SettingsSwitchProps) {
  const tint = disabled ? { color: theme.neutral.textMuted, border: theme.neutral.border } : accent

  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: theme.neutral.border, true: tint.border }}
      thumbColor={value ? tint.color : theme.neutral.textMuted}
      ios_backgroundColor={theme.neutral.border}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    />
  )
}
