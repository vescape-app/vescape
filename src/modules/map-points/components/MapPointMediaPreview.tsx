import { useEventListener } from 'expo'
import { Image } from 'expo-image'
import { VideoView, useVideoPlayer } from 'expo-video'
import {
  CaretLeftIcon,
  CaretRightIcon,
  ImagesSquareIcon,
  PlayIcon,
  XIcon,
} from 'phosphor-react-native'
import { useMemo, useState } from 'react'
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { MapPointMediaAsset } from '@/modules/map-points/store/mapPointPhotoFiles'

import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

const GRID_COLUMNS = 4
const GRID_GAP = 6

function MapPointVideoAsset({ asset }: { asset: MapPointMediaAsset }) {
  const [unavailable, setUnavailable] = useState(false)
  const player = useVideoPlayer(asset.uri, (instance) => {
    instance.play()
  })
  useEventListener(player, 'statusChange', ({ status }) => setUnavailable(status === 'error'))
  return (
    <>
      <VideoView
        player={player}
        nativeControls
        contentFit="contain"
        surfaceType="textureView"
        style={styles.media}
      />
      {unavailable ? <Text style={styles.mediaUnavailable}>Video unavailable</Text> : null}
    </>
  )
}

function MapPointPhotoAsset({ asset }: { asset: MapPointMediaAsset }) {
  const [unavailable, setUnavailable] = useState(false)
  return (
    <>
      <Image
        source={asset.uri}
        contentFit="contain"
        style={styles.media}
        onError={() => setUnavailable(true)}
      />
      {unavailable ? <Text style={styles.mediaUnavailable}>Photo unavailable</Text> : null}
    </>
  )
}

function MapPointMediaViewer({
  assets,
  initialAssetId,
  onClose,
}: {
  assets: readonly MapPointMediaAsset[]
  initialAssetId: string
  onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  const orderedAssets = useMemo(
    () => [...assets].sort((a, b) => a.id.localeCompare(b.id)),
    [assets],
  )
  const [index, setIndex] = useState(() => {
    const initialIndex = orderedAssets.findIndex((asset) => asset.id === initialAssetId)
    return initialIndex >= 0 ? initialIndex : 0
  })
  const asset = orderedAssets[Math.min(index, orderedAssets.length - 1)]

  if (!asset) return null

  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.viewerContainer}>
        {asset.mediaType === 'video' ? (
          <MapPointVideoAsset key={asset.id} asset={asset} />
        ) : (
          <MapPointPhotoAsset key={asset.id} asset={asset} />
        )}
        <IconButton
          icon={XIcon}
          onPress={onClose}
          style={[styles.close, { top: Math.max(insets.top + 10, 20) }]}
        />
        {orderedAssets.length > 1 ? (
          <>
            <IconButton
              icon={CaretLeftIcon}
              onPress={() => setIndex((current) => Math.max(0, current - 1))}
              disabled={index === 0}
              style={styles.previous}
            />
            <IconButton
              icon={CaretRightIcon}
              onPress={() => setIndex((current) => Math.min(orderedAssets.length - 1, current + 1))}
              disabled={index === orderedAssets.length - 1}
              style={styles.next}
            />
            <Text style={[styles.position, { bottom: Math.max(insets.bottom, 12) }]}>
              {index + 1} / {orderedAssets.length}
            </Text>
          </>
        ) : null}
      </View>
    </Modal>
  )
}

export function MapPointMediaPreview({
  assets,
  onRemove,
}: {
  assets: readonly MapPointMediaAsset[]
  onRemove?: (asset: MapPointMediaAsset) => void
}) {
  const { width } = useWindowDimensions()
  const [openAssetId, setOpenAssetId] = useState<string | null>(null)
  const tileSize = Math.max(
    54,
    Math.min(76, (width - 48 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS),
  )

  if (assets.length === 0) {
    return (
      <View style={styles.empty}>
        <ImagesSquareIcon size={24} color={theme.neutral.textMuted} weight="duotone" />
        <Text style={styles.emptyText}>Add photos and videos for this feature.</Text>
      </View>
    )
  }

  return (
    <>
      <View style={styles.grid}>
        {assets.map((asset) => (
          <Pressable
            key={asset.id}
            accessibilityRole="button"
            accessibilityLabel={`Open ${asset.mediaType}`}
            onPress={() => setOpenAssetId(asset.id)}
            onLongPress={onRemove ? () => onRemove(asset) : undefined}
            style={({ pressed }) => [
              styles.tile,
              { width: tileSize, height: tileSize },
              pressed && styles.tilePressed,
            ]}
          >
            <Image source={asset.uri} contentFit="cover" style={styles.thumbnail} />
            {asset.mediaType === 'video' ? (
              <View style={styles.videoBadge}>
                <PlayIcon size={10} color={theme.palette.purple.text} weight="fill" />
              </View>
            ) : null}
            {onRemove ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${asset.mediaType}`}
                hitSlop={8}
                onPress={() => onRemove(asset)}
                style={({ pressed }) => [styles.removeBadge, pressed && styles.tilePressed]}
              >
                <XIcon size={10} color={theme.status.error.text} weight="bold" />
              </Pressable>
            ) : null}
          </Pressable>
        ))}
      </View>
      {openAssetId ? (
        <MapPointMediaViewer
          assets={assets}
          initialAssetId={openAssetId}
          onClose={() => setOpenAssetId(null)}
        />
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  emptyText: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  tile: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: theme.neutral.surfaceDeep,
  },
  tilePressed: {
    opacity: 0.55,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  videoBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.alpha(theme.neutral.surfaceDeep, 0.6),
  },
  viewerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.neutral.surfaceDeep,
  },
  media: {
    ...StyleSheet.absoluteFill,
  },
  close: {
    position: 'absolute',
    right: 10,
  },
  previous: {
    position: 'absolute',
    left: 10,
    top: '50%',
  },
  next: {
    position: 'absolute',
    right: 10,
    top: '50%',
  },
  position: {
    position: 'absolute',
    bottom: 12,
    color: theme.neutral.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  mediaUnavailable: {
    color: theme.status.error.text,
    fontSize: 13,
    fontWeight: '700',
  },
  removeBadge: {
    position: 'absolute',
    left: 4,
    top: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.alpha(theme.neutral.surfaceDeep, 0.8),
  },
})
