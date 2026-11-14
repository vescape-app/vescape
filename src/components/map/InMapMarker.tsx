import { MarkerView } from '@rnmapbox/maps'
import {
  createContext,
  type ReactElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { findNodeHandle, StyleSheet, View } from 'react-native'

import { markerLayerChannel, useInMapLayer } from '@/components/map/inMapLayer'

/** Snapshots keep running this long after a change: the mount lands on screen a frame or two later. */
const SNAPSHOT_BURST_MS = 300

const RefreshContext = createContext<() => void>(() => {})

/**
 * Re-snapshots the enclosing in-map marker. For content that changes without a render of the
 * marker's owner, such as an image finishing its decode.
 */
export function useInMapMarkerRefresh() {
  return useContext(RefreshContext)
}

/**
 * A point on the map drawn from React views that stays glued to the map while the camera moves.
 *
 * Where the map layer renders (the main map), the marker view stays mounted but transparent: it is the
 * look's source and keeps every touch exactly as before, and the native layer draws a snapshot of
 * it inside the map's frame. Each render of the owner re-snapshots it; touches re-snapshot it too,
 * for pressed feedback. Elsewhere it is a plain `MarkerView`.
 */
export function InMapMarker({
  coordinate,
  animationMs = 0,
  children,
}: {
  coordinate: [number, number]
  /** How long the content animates after mounting, so every frame of it is snapshotted. */
  animationMs?: number
  children: ReactElement
}) {
  const ref = useRef<View>(null)
  const [key] = useState(() => ({}))
  const [refresh] = useState(() => () => markerLayerChannel.refresh(key))
  const burstMs = SNAPSHOT_BURST_MS + animationMs
  // No deps: every render may have changed the look.
  const { layer, view } = useInMapLayer()
  useLayoutEffect(() => {
    if (!layer) return
    const tag = findNodeHandle(ref.current)
    if (tag != null) markerLayerChannel.set(key, tag, coordinate, burstMs)
  })
  useEffect(() => () => markerLayerChannel.remove(key), [key])
  return (
    <MarkerView coordinate={coordinate} allowOverlap>
      <View
        ref={ref}
        collapsable={false}
        style={view ? undefined : styles.ghost}
        onTouchStart={layer ? refresh : undefined}
        onTouchEnd={layer ? refresh : undefined}
        onTouchCancel={layer ? refresh : undefined}
      >
        <RefreshContext.Provider value={refresh}>{children}</RefreshContext.Provider>
      </View>
    </MarkerView>
  )
}

const styles = StyleSheet.create({
  // Transparent, not hidden: it still lays out and takes touches. The snapshot leaves out the
  // root's own opacity.
  ghost: { opacity: 0 },
})
