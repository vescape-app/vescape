import { useEffect } from 'react'

import {
  AccessorySelectorSection,
  type AccessorySelectorItem,
} from '@/modules/accessories/components/AccessorySelectorSection'
import { accessoryNeedsSetup, useAccessoryStore } from '@/modules/accessories/store/accessoryStore'

export function BoardSelectorAccessories({
  onOpenAccessory,
}: {
  onOpenAccessory: (accessoryId: string) => void
}) {
  const accessories = useAccessoryStore((s) => s.accessories)
  const sync = useAccessoryStore((s) => s.sync)

  useEffect(() => {
    sync()
  }, [sync])

  const items: AccessorySelectorItem[] = accessories.map((accessory) => ({
    accessoryId: accessory.accessoryId,
    name: accessory.name,
    detail: `v${accessory.firmwareVersion}`,
    phase: accessory.phase,
    needsSetup: accessoryNeedsSetup(accessory),
  }))

  return <AccessorySelectorSection accessories={items} onSelectAccessory={onOpenAccessory} />
}
