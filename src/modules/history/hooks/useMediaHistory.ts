import { useCallback, useEffect, useMemo, useState } from 'react'
import * as ImagePicker from 'expo-image-picker'
import {
  getFavoriteMedia,
  importFavoriteMedia,
  type FavoriteMedia,
  type ImportFavoriteMediaOptions,
} from 'vescape-core'

import {
  matchMediaHistoryAssets,
  resolvePickedAssetCreationTime,
  type MediaAssetInput,
} from '@/modules/history/lib/mediaHistory'
import type {
  HistoryGpsSample,
  HistoryMarker,
  HistorySession,
} from '@/modules/history/store/historyStore'
// Google Play's Photo and Video Permissions policy forbids READ_MEDIA_IMAGES/READ_MEDIA_VIDEO
// for this feature, so Favorite Media comes from the permissionless system photo picker.
async function pickFavoriteMedia(favoriteId: string): Promise<ImportFavoriteMediaOptions[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsMultipleSelection: true,
    exif: true,
    quality: 1,
  })
  if (result.canceled) return []
  return result.assets.map((asset) => {
    const capturedAtMs = resolvePickedAssetCreationTime({
      exif: asset.exif,
      filename: asset.fileName ?? '',
    })
    return {
      favoriteId,
      uri: asset.uri,
      ...(capturedAtMs == null ? {} : { capturedAtMs }),
      mimeType: asset.mimeType ?? (asset.type === 'video' ? 'video/mp4' : 'image/jpeg'),
      mediaKind: asset.type === 'video' ? ('video' as const) : ('photo' as const),
    }
  })
}

function toMediaAsset(media: FavoriteMedia): MediaAssetInput {
  return {
    id: media.id,
    uri: media.uri,
    filename: media.filename,
    mediaType: media.mediaKind,
    creationTime: media.capturedAtMs ?? Number.NaN,
  }
}

export function useFavoriteMedia({
  favoriteId,
  selectedSession,
  gpsSamples,
  markers,
}: {
  favoriteId: string | null
  selectedSession: HistorySession | null
  gpsSamples: HistoryGpsSample[]
  markers: HistoryMarker[]
}) {
  const [stored, setStored] = useState<MediaAssetInput[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setError(null)
      if (!selectedSession || !favoriteId) {
        setStored([])
        return
      }
      void getFavoriteMedia(favoriteId)
        .then((media) => {
          if (!cancelled) setStored(media.map(toMediaAsset))
        })
        .catch((cause: unknown) => {
          if (cancelled) return
          setStored([])
          setError(cause instanceof Error ? cause.message : 'Could not read Favorite Media')
        })
    })
    return () => {
      cancelled = true
    }
  }, [favoriteId, selectedSession])

  const add = useCallback(async () => {
    if (!selectedSession || !favoriteId) return
    setLoading(true)
    setError(null)
    try {
      const picked = await pickFavoriteMedia(favoriteId)
      if (picked.length === 0) return
      const imports = await Promise.allSettled(picked.map((media) => importFavoriteMedia(media)))
      setStored((await getFavoriteMedia(favoriteId)).map(toMediaAsset))
      const failedCount = imports.filter((result) => result.status === 'rejected').length
      if (failedCount > 0) {
        setError(`Could not save ${failedCount} of ${picked.length} Favorite Media items`)
      }
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Could not save Favorite Media')
    } finally {
      setLoading(false)
    }
  }, [favoriteId, selectedSession])

  const { assets, unmatched } = useMemo(() => {
    if (!selectedSession || stored.length === 0) {
      return { assets: [], unmatched: [] }
    }
    const matched = matchMediaHistoryAssets({
      assets: stored,
      gpsSamples,
      markers,
      startAtMs: selectedSession.startAtMs,
      endAtMs: selectedSession.endAtMs,
    })
    const matchedIds = new Set(matched.map((asset) => asset.id))
    return {
      assets: matched,
      unmatched: stored.filter((asset) => !matchedIds.has(asset.id)),
    }
  }, [gpsSamples, markers, selectedSession, stored])

  return {
    assets,
    unmatched,
    loading,
    error,
    add,
  }
}
