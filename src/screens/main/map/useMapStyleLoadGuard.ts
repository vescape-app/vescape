import { useCallback, useEffect, useEffectEvent, useReducer, useRef } from 'react'

import type { MapStyleKey } from '@/modules/map/constants/mapStyles'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import {
  initialMapStyleLifecycle,
  mapStyleLifecycle,
  type MapStyleDocument,
} from '@/screens/main/map/mapStyleLifecycle'

/** Owns the applied document, load readiness, retries, and camera initialization together. */
export function useMapStyleLoadGuard({
  document,
  onStyleLoaded,
}: {
  document: MapStyleDocument
  onStyleLoaded: (preserveCamera: boolean) => void
}) {
  const setSetting = useSettingsStore((state) => state.set)
  const [state, dispatch] = useReducer(mapStyleLifecycle, document, initialMapStyleLifecycle)
  const lastLoadedStyleKeyRef = useRef<MapStyleKey | null>(null)

  const { styleKey, styleSignature, styleURL, styleJSON } = document
  useEffect(() => {
    dispatch({ type: 'request', document: { styleKey, styleSignature, styleURL, styleJSON } })
  }, [styleKey, styleSignature, styleURL, styleJSON])

  useEffect(() => {
    if (state.phase !== 'detaching') return
    // First commit without adopted layers, then replace the already-completed document.
    const frame = requestAnimationFrame(() => dispatch({ type: 'apply' }))
    return () => cancelAnimationFrame(frame)
  }, [state.phase])

  const notifyLoaded = useEffectEvent(() => {
    lastLoadedStyleKeyRef.current = state.applied.styleKey
    onStyleLoaded(state.loadCount > 1)
  })
  useEffect(() => {
    if (state.loadCount > 0) notifyLoaded()
  }, [state.generation, state.loadCount])

  const handleStyleLoaded = useCallback(() => {
    dispatch({ type: 'loaded', generation: state.generation })
  }, [state.generation])

  const handleStyleLoadError = useCallback(() => {
    dispatch({ type: 'failed', generation: state.generation })
  }, [state.generation])

  useEffect(() => {
    if (state.phase !== 'failed') return
    const lastLoaded = lastLoadedStyleKeyRef.current
    if (lastLoaded != null && lastLoaded !== state.applied.styleKey) {
      lastLoadedStyleKeyRef.current = null
      void setSetting('mapStyleKey', lastLoaded)
    }
  }, [setSetting, state.applied.styleKey, state.phase])

  const retryStyleLoad = useCallback(() => dispatch({ type: 'retry' }), [])
  const styleReady =
    state.phase === 'ready' && state.applied.styleSignature === document.styleSignature

  return {
    appliedStyle: state.applied,
    styleReady,
    mapStyleLoading: !styleReady,
    mapLoadFailed: state.phase === 'failed',
    handleStyleLoaded,
    handleStyleLoadError,
    retryStyleLoad,
    styleRetryNonce: state.generation,
  }
}
