import type { ReactNode } from 'react'
import { RiderProfileSections } from '@/modules/group-ride/components/public-ride-prototype/RiderProfileSections'
import { DEMO_PROFILE_BOARDS } from '@/modules/group-ride/components/public-ride-prototype/profileFixtures'
import { MOCK_RIDERS } from '@/modules/group-ride/components/public-ride-prototype/fixtures'

export function ProfileSectionsPrototype({
  variant,
  active,
  identity,
}: {
  variant: number
  active: boolean
  identity: ReactNode
}) {
  return (
    <RiderProfileSections
      variant={variant}
      active={active}
      identity={identity}
      rider={{ ...MOCK_RIDERS[2]!, speed: 22.4, controller: 38, motor: 46 }}
      boards={DEMO_PROFILE_BOARDS}
      showControls
    />
  )
}
