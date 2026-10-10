import { useLocalSearchParams } from 'expo-router'

import { GroundClearanceScreen } from '@/modules/accessories/screens/GroundClearanceScreen'

export default function GroundClearanceRoute() {
  const { accessoryId, capabilityId } = useLocalSearchParams<{
    accessoryId: string
    capabilityId: string
  }>()
  return <GroundClearanceScreen accessoryId={accessoryId} capabilityId={capabilityId} />
}
