import { useRouter } from 'expo-router'
import { ArrowLeftIcon } from 'phosphor-react-native'

import { IconButton } from '@/components/base/IconButton'

export function HeaderBackButton() {
  const router = useRouter()
  return <IconButton testID="header-back" icon={ArrowLeftIcon} onPress={() => router.back()} />
}
