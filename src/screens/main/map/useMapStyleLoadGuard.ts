import { useCallback, useEffect, useReducer, useRef } from 'react'

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

  const { styleKey, styleSignature, mapStyle } = document
  useEffect(() => {
    dispatch({ type: 'request', document: { styleKey, styleSignature, mapStyle } })
  }, [styleKey, styleSignature, mapStyle])

  useEffect(() => {
    if (state.phase !== 'detaching') return
    // First commit without adopted layers, then replace the already-completed document.
    const frame = requestAnimationFrame(() => dispatch({ type: 'apply' }))
    return () => cancelAnimationFrame(frame)
  }, [state.phase])

  // A ref, not `useEffectEvent`: under the React Compiler the effect event read the first
  // render's `loadCount`, so every style swap reported a fresh map and reset the camera.
  const onStyleLoadedRef = useRef(onStyleLoaded)
  useEffect(() => {
    onStyleLoadedRef.current = onStyleLoaded
  })
  const { loadCount, generation } = state
  const loadedStyleKey = state.applied.styleKey
  useEffect(() => {
    if (loadCount === 0) return
    lastLoadedStyleKeyRef.current = loadedStyleKey
    onStyleLoadedRef.current(loadCount > 1)
    // Once per completed load; the applied key is read with it, not a trigger of its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation, loadCount])

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
