import {
  AccessorySelectorSection,
  type AccessorySelectorItem,
} from '@/modules/accessories/components/AccessorySelectorSection'
import {
  accessoryLinkStatus,
  useAccessoryDiscoveryStore,
} from '@/modules/accessories/store/accessoryDiscoveryStore'

/**
 * The Accessories section of the Board selector, composed here rather than inside the selector.
 *
 * The selector belongs to the Board domain and must not learn about hardware; this is the seam
 * where the two meet. Accessories are listed flat, because an Accessory Binding targets whichever
 * Board is connected, not the Board whose row it happens to sit under.
 */
export function BoardSelectorAccessories({
  onOpenAccessory,
  onAddAccessory,
}: {
  onOpenAccessory: (accessoryId: string) => void
  onAddAccessory: () => void
}) {
  const accessories = useAccessoryDiscoveryStore((s) => s.accessories)
  const devices = useAccessoryDiscoveryStore((s) => s.devices)

  const items: AccessorySelectorItem[] = accessories.map((accessory) => ({
    accessoryId: accessory.accessoryId,
    name: accessory.manifest.name,
    detail: `v${accessory.manifest.firmwareVersion}`,
    status: accessoryLinkStatus(accessory, devices),
    incompatible: accessory.manifest.compatibility !== 'supported',
  }))

  return (
    <AccessorySelectorSection
      accessories={items}
      onSelectAccessory={onOpenAccessory}
      onAddAccessory={onAddAccessory}
    />
  )
}
