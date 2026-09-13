import { router, useLocalSearchParams } from 'expo-router'

import { AccessoryDetailScreen } from '@/modules/accessories/screens/AccessoryDetailScreen'
import { routes } from '@/navigation/routes'

export default function AccessoryRoute() {
  const { accessoryId } = useLocalSearchParams<{ accessoryId: string }>()
  return (
    <AccessoryDetailScreen
      accessoryId={accessoryId}
      onForgotten={() => {
        if (router.canGoBack()) router.back()
      }}
      onConfigureCapability={(capabilityId) =>
        router.push({
          pathname: routes.accessoryGroundClearance,
          params: { accessoryId, capabilityId },
        })
      }
    />
  )
}
