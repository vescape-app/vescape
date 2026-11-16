import { useRouter, type Href } from 'expo-router'
import { ArrowLeftIcon } from 'phosphor-react-native'

import { IconButton } from '@/components/base/IconButton'

export function HeaderBackButton({ fallback }: { fallback?: Href }) {
  const router = useRouter()
  return (
    <IconButton
      testID="header-back"
      icon={ArrowLeftIcon}
      accessibilityLabel="Back"
      onPress={() => {
        if (fallback && !router.canGoBack()) router.replace(fallback)
        else router.back()
      }}
    />
  )
}
