import { router } from 'expo-router'

import { AccessoriesScreen } from '@/modules/accessories/screens/AccessoriesScreen'
import { routes } from '@/navigation/routes'

export default function AccessoriesRoute() {
  return (
    <AccessoriesScreen
      onAddAccessory={() => router.push(routes.accessoryScan)}
      onOpenAccessory={(accessoryId) =>
        router.push({ pathname: routes.accessory, params: { accessoryId } })
      }
    />
  )
}
