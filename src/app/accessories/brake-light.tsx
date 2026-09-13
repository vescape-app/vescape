import { useLocalSearchParams } from 'expo-router'

import { BrakeLightScreen } from '@/modules/accessories/screens/BrakeLightScreen'

export default function BrakeLightRoute() {
  const { accessoryId, capabilityId } = useLocalSearchParams<{
    accessoryId: string
    capabilityId: string
  }>()
  return <BrakeLightScreen accessoryId={accessoryId} capabilityId={capabilityId} />
}
