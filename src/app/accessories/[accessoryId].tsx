import { useLocalSearchParams } from 'expo-router'

import { AccessoryDetailScreen } from '@/modules/accessories/screens/AccessoryDetailScreen'

export default function AccessoryRoute() {
  const { accessoryId } = useLocalSearchParams<{ accessoryId: string }>()
  return <AccessoryDetailScreen accessoryId={accessoryId} />
}
