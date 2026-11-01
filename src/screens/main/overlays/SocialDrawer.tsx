import { useState, type RefObject } from 'react'
import { usePublicRidePrototypeStore } from '@/modules/group-ride/components/public-ride-prototype/prototypeStore'
import type { View } from 'react-native'
import { UsersThreeIcon } from 'phosphor-react-native'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { SocialSheet } from '@/modules/group-ride/components/SocialSheet'
import { SocialDrawerHeader } from '@/modules/group-ride/components/public-ride-prototype/SocialDrawerHeader'
import { publicRidePageRider } from '@/modules/group-ride/components/public-ride-prototype/fixtures'

export function SocialDrawer({
  visible,
  triggerRef,
  onClose,
  onEnterMap,
}: {
  visible: boolean
  triggerRef: RefObject<View | null>
  onClose: () => void
  onEnterMap: () => void
}) {
  const [page, setPage] = useState('nearby')
  const inactiveFriends = usePublicRidePrototypeStore((state) => state.inactiveFriends)
  const rider = __DEV__ ? publicRidePageRider(page, inactiveFriends) : null
  const back = () => setPage('nearby')
  return (
    <EdgeDrawer
      visible={visible}
      triggerRef={triggerRef}
      edge="top"
      title="Social"
      contentPageKey={page}
      icon={UsersThreeIcon}
      backdropTestID="social-drawer-backdrop"
      onClose={onClose}
      onBack={rider ? back : undefined}
      header={
        __DEV__ ? (
          <SocialDrawerHeader riderName={rider?.name} onBack={back} onClose={onClose} />
        ) : undefined
      }
    >
      <SocialSheet
        page={page}
        onPageChange={setPage}
        onShowOnMap={() => {
          onClose()
          onEnterMap()
        }}
      />
    </EdgeDrawer>
  )
}
