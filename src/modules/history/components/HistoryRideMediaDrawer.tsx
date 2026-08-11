import { ImagesSquareIcon } from 'phosphor-react-native'
import type { RefObject } from 'react'
import type { View } from 'react-native'

import { EdgeDrawer } from '@/components/overlays/AnchoredSheet'
import { MediaHistoryGallery } from '@/modules/history/components/MediaHistoryGallery'
import type { MediaAssetInput, MediaHistoryAsset } from '@/modules/history/lib/mediaHistory'

interface HistoryRideMediaDrawerProps {
  visible: boolean
  triggerRef: RefObject<View | null>
  assets: MediaHistoryAsset[]
  unmatched: MediaAssetInput[]
  loading: boolean
  error: string | null
  onClose: () => void
  onAdd: () => void
  onOpenMedia: (asset: MediaAssetInput) => void
}

export function HistoryRideMediaDrawer({
  visible,
  triggerRef,
  assets,
  unmatched,
  loading,
  error,
  onClose,
  onAdd,
  onOpenMedia,
}: HistoryRideMediaDrawerProps) {
  return (
    <EdgeDrawer
      visible={visible}
      triggerRef={triggerRef}
      onClose={onClose}
      title="Favorite Media"
      icon={ImagesSquareIcon}
    >
      <MediaHistoryGallery
        assets={assets}
        unmatched={unmatched}
        loading={loading}
        error={error}
        onAdd={onAdd}
        onOpenAsset={(asset) => {
          onClose()
          onOpenMedia(asset)
        }}
      />
    </EdgeDrawer>
  )
}
