import { router } from 'expo-router'

import { AccessoryScanScreen } from '@/modules/accessories/screens/AccessoryScanScreen'
import { routes } from '@/navigation/routes'

export default function AccessoryScanRoute() {
  return (
    <AccessoryScanScreen
      onOpenAccessory={(accessoryId) =>
        router.replace({ pathname: routes.accessory, params: { accessoryId } })
      }
    />
  )
}
