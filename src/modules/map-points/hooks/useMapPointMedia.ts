import * as ImagePicker from 'expo-image-picker'
import { useCallback, useState } from 'react'
import type { MapPoint } from 'vescape-core'

import {
  deleteMapPointMediaAsset,
  saveMapPointMediaAssets,
  type MapPointMediaAsset,
  type PickedMapPointMediaAsset,
} from '@/modules/map-points/store/mapPointPhotoFiles'

export interface MapPointMediaController {
  assets: readonly MapPointMediaAsset[]
  saving: boolean
  pick: () => Promise<void>
  capture: (mediaTypes: ['images'] | ['videos']) => Promise<void>
  remove: (asset: MapPointMediaAsset) => void
}

function toPickedAssets(assets: ImagePicker.ImagePickerAsset[]): PickedMapPointMediaAsset[] {
  return assets.map((asset) => ({
    id: asset.assetId ?? asset.uri,
    uri: asset.uri,
    filename: asset.fileName ?? '',
    mediaType: asset.type === 'video' ? 'video' : 'photo',
  }))
}

export function useMapPointMedia(point: MapPoint | null): MapPointMediaController {
  const [assets, setAssets] = useState<MapPointMediaAsset[]>([])
  const [saving, setSaving] = useState(false)

  const savePicked = useCallback(
    async (picked: PickedMapPointMediaAsset[]) => {
      if (!point) return
      setSaving(true)
      try {
        const saved = await saveMapPointMediaAssets(point.id, picked)
        setAssets((current) => {
          const existingUris = new Set(current.map((asset) => asset.uri))
          return [...current, ...saved.filter((asset) => !existingUris.has(asset.uri))]
        })
      } finally {
        setSaving(false)
      }
    },
    [point],
  )

  const pick = useCallback(async () => {
    if (!point) return
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      quality: 0.9,
    })
    if (result.canceled || !result.assets[0]?.uri) return
    await savePicked(toPickedAssets(result.assets))
  }, [point, savePicked])

  const capture = useCallback(
    async (mediaTypes: ['images'] | ['videos']) => {
      if (!point) return
      const permission = await ImagePicker.getCameraPermissionsAsync()
      const granted = permission.granted
        ? true
        : (await ImagePicker.requestCameraPermissionsAsync()).granted
      if (!granted) return

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes,
        quality: 0.9,
        videoQuality: ImagePicker.UIImagePickerControllerQualityType.High,
      })
      if (result.canceled || !result.assets[0]?.uri) return
      await savePicked(toPickedAssets(result.assets))
    },
    [point, savePicked],
  )

  const remove = useCallback((asset: MapPointMediaAsset) => {
    setAssets((current) => current.filter((candidate) => candidate.uri !== asset.uri))
    deleteMapPointMediaAsset(asset.uri)
  }, [])

  return { assets, saving, pick, capture, remove }
}
