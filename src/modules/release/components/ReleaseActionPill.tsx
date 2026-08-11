import { ArrowFatLinesUpIcon, NewspaperClippingIcon } from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { theme } from '@/constants/theme'

interface ReleaseActionPillProps {
  latestVersion?: string
  onPress: () => void
}

export function ReleaseActionPill({ latestVersion, onPress }: ReleaseActionPillProps) {
  const updateAvailable = latestVersion !== undefined

  return (
    <Button
      label={updateAvailable ? `Update to v${latestVersion}` : "Check what's new"}
      onPress={onPress}
      icon={updateAvailable ? ArrowFatLinesUpIcon : NewspaperClippingIcon}
      variant={updateAvailable ? 'primary' : 'accent'}
      accessibilityLabel={
        updateAvailable
          ? `Update Vescape to version ${latestVersion}`
          : "Check what's new in Vescape"
      }
      style={[
        { marginTop: 12 },
        updateAvailable ? { backgroundColor: theme.status.upgrade.color } : null,
      ]}
    />
  )
}
