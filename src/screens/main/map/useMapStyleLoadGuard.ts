import { useCallback, useEffect, useRef, useState } from 'react'

import type { MapStyleKey } from '@/modules/map/constants/mapStyles'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

/**
 * Guards style document swaps so the map never sits blank. Tracks the last style that
 * actually loaded; a failed load falls back to it in one shot, and a second consecutive
 * failure surfaces a retry overlay instead of looping forever.
 */
export function useMapStyleLoadGuard({
  mapStyleKey,
  styleSignature,
  loadedStyleSignature,
  onStyleLoaded,
}: {
  mapStyleKey: MapStyleKey
  styleSignature: string
  loadedStyleSignature: string | null
  onStyleLoaded: () => void
}) {
  const setSetting = useSettingsStore((state) => state.set)
  const [mapLoadFailed, setMapLoadFailed] = useState(false)
  const [styleRetryNonce, setStyleRetryNonce] = useState(0)
  const lastLoadedStyleKeyRef = useRef<MapStyleKey | null>(null)

  const mapStyleLoading = loadedStyleSignature !== styleSignature

  const handleStyleLoaded = useCallback(() => {
    lastLoadedStyleKeyRef.current = mapStyleKey
    setMapLoadFailed(false)
    onStyleLoaded()
  }, [mapStyleKey, onStyleLoaded])

  const handleStyleLoadError = useCallback(() => {
    const lastLoaded = lastLoadedStyleKeyRef.current
    if (lastLoaded != null && lastLoaded !== mapStyleKey) {
      lastLoadedStyleKeyRef.current = null
      void setSetting('mapStyleKey', lastLoaded)
      return
    }
    setMapLoadFailed(true)
  }, [mapStyleKey, setSetting])

  const retryStyleLoad = useCallback(() => {
    setMapLoadFailed(false)
    setStyleRetryNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    setMapLoadFailed(false)
  }, [mapStyleKey])

  return {
    mapStyleLoading,
    mapLoadFailed,
    handleStyleLoaded,
    handleStyleLoadError,
    retryStyleLoad,
    styleRetryNonce,
  }
}
