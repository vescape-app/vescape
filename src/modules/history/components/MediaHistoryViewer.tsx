import { useEventListener } from 'expo'
import { Image } from 'expo-image'
import { VideoView, useVideoPlayer } from 'expo-video'
import {
  BatteryMediumIcon,
  CaretLeftIcon,
  CaretRightIcon,
  GaugeIcon,
  LightningIcon,
  XIcon,
  type Icon,
} from 'phosphor-react-native'
import { useMemo, useState } from 'react'
import { Modal, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { HistoryMarker, TelemetrySample } from 'vescape-core'

import { IconButton } from '@/components/base/IconButton'
import { telemetry } from '@/modules/board/constants/telemetry'
import { dutyPercent } from '@/helpers/format'
import { findVideoTelemetrySample, type MediaAssetInput } from '@/modules/history/lib/mediaHistory'
import { theme } from '@/constants/theme'

function VideoAsset({
  asset,
  samples,
  markers,
  top,
}: {
  asset: MediaAssetInput
  samples: TelemetrySample[]
  markers: HistoryMarker[]
  top: number
}) {
  const [playbackSeconds, setPlaybackSeconds] = useState(0)
  const [unavailable, setUnavailable] = useState(false)
  const player = useVideoPlayer(asset.uri, (instance) => {
    instance.timeUpdateEventInterval = 0.25
    instance.play()
  })
  useEventListener(player, 'timeUpdate', ({ currentTime }) => setPlaybackSeconds(currentTime))
  useEventListener(player, 'statusChange', ({ status }) => setUnavailable(status === 'error'))
  const sample = useMemo(
    () => findVideoTelemetrySample(samples, markers, asset.creationTime, playbackSeconds),
    [asset.creationTime, markers, playbackSeconds, samples],
  )
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
      {sample ? (
        <View style={[styles.telemetryRow, { top }]}>
          <VideoTelemetryStat
            label="Speed"
            value={telemetry.speed.formatWithUnit(sample.speedKmh)}
            icon={GaugeIcon}
            accent={telemetry.speed.color}
          />
          <VideoTelemetryStat
            label="Duty"
            value={telemetry.duty.formatWithUnit(dutyPercent(sample.dutyCycle, false))}
            icon={LightningIcon}
            accent={telemetry.duty.color}
          />
          <VideoTelemetryStat
            label="Battery"
            value={telemetry.battVoltage.formatWithUnit(sample.batteryVoltage)}
            icon={BatteryMediumIcon}
            accent={telemetry.battVoltage.color}
          />
        </View>
      ) : null}
    </>
  )
}

function VideoTelemetryStat({
  label,
  value,
  icon: IconComponent,
  accent,
}: {
  label: string
  value: string
  icon: Icon
  accent: string
}) {
  return (
    <View style={styles.telemetryStat}>
      <Text style={styles.telemetryLabel}>{label}</Text>
      <View style={styles.telemetryValueRow}>
        <IconComponent size={18} color={accent} weight="duotone" />
        <Text style={styles.telemetryValue}>{value}</Text>
      </View>
    </View>
  )
}

function PhotoAsset({ asset }: { asset: MediaAssetInput }) {
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

export function MediaHistoryViewer({
  assets,
  initialAssetId,
  samples,
  markers,
  onClose,
}: {
  assets: MediaAssetInput[]
  initialAssetId: string
  samples: TelemetrySample[]
  markers: HistoryMarker[]
  onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  // Assets without a recoverable creation time (NaN) sort to the end.
  const orderedAssets = useMemo(() => {
    const time = (asset: MediaAssetInput) =>
      Number.isFinite(asset.creationTime) ? asset.creationTime : Number.POSITIVE_INFINITY
    return [...assets].sort((a, b) => time(a) - time(b) || a.id.localeCompare(b.id))
  }, [assets])
  const [index, setIndex] = useState(() => {
    const initialIndex = orderedAssets.findIndex((asset) => asset.id === initialAssetId)
    return initialIndex >= 0 ? initialIndex : 0
  })
  const asset = orderedAssets[Math.min(index, orderedAssets.length - 1)]

  if (!asset) return null

  const headerTop = Math.max(insets.top, 10)

  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.container}>
        {asset.mediaType === 'video' ? (
          <VideoAsset
            key={asset.id}
            asset={asset}
            samples={samples}
            markers={markers}
            top={headerTop}
          />
        ) : (
          <PhotoAsset key={asset.id} asset={asset} />
        )}
        <IconButton icon={XIcon} onPress={onClose} style={[styles.close, { top: headerTop }]} />
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

const styles = StyleSheet.create({
  container: {
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
    color: theme.neutral.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  telemetryRow: {
    position: 'absolute',
    left: 10,
    right: 58,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  telemetryStat: {
    flex: 1,
    minWidth: 0,
    height: 48,
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.alpha(theme.palette.slate.light, 0.3),
    backgroundColor: theme.alpha(theme.neutral.surfaceDeep, 0.6),
  },
  telemetryLabel: {
    color: theme.neutral.textMuted,
    fontSize: 9,
    fontWeight: '700',
  },
  telemetryValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  telemetryValue: {
    color: theme.neutral.textPrimary,
    fontSize: 14,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  mediaUnavailable: {
    color: theme.status.error.text,
    fontSize: 13,
    fontWeight: '800',
    backgroundColor: theme.alpha(theme.neutral.surfaceDeep, 0.85),
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
})
