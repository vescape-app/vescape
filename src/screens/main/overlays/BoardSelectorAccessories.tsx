import { useEffect } from 'react'

import {
  AccessorySelectorSection,
  type AccessorySelectorItem,
} from '@/modules/accessories/components/AccessorySelectorSection'
import { accessoryNeedsSetup, useAccessoryStore } from '@/modules/accessories/store/accessoryStore'

/**
 * The Accessories section of the Board selector, composed here rather than inside the selector.
 *
 * The selector belongs to the Board domain and must not learn about hardware; this is the seam
 * where the two meet. Accessories are listed flat, because an Accessory Binding targets whichever
 * Board is connected, not the Board whose row it happens to sit under.
 *
 * Everything shown is native's: these are saved Accessories with the link state native currently
 * holds, not this session's sightings. A row reads "Connecting…" because a native session is
 * connecting, with or without this screen ever having been opened.
 */
export function BoardSelectorAccessories({
  onOpenAccessory,
  onAddAccessory,
}: {
  onOpenAccessory: (accessoryId: string) => void
  onAddAccessory: () => void
}) {
  const accessories = useAccessoryStore((s) => s.accessories)
  const sync = useAccessoryStore((s) => s.sync)

  // Opening the selector is a foreground moment: read native truth rather than trusting whatever
  // the last push left behind while nothing was mounted.
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

  return (
    <AccessorySelectorSection
      accessories={items}
      onSelectAccessory={onOpenAccessory}
      onAddAccessory={onAddAccessory}
    />
  )
}
