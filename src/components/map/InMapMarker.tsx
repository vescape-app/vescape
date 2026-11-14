import { MarkerView } from '@rnmapbox/maps'
import {
  createContext,
  memo,
  type ReactElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { findNodeHandle, View } from 'react-native'

import { useInMapLayer } from '@/components/map/inMapLayer'
import { markerLayerChannel } from '@/components/map/markerLayerChannel'
import { sameLook } from '@/components/map/sameLook'

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
 * Where the map layer renders (the main map), the marker view stays mounted as the look's source
 * and the touch target, and the native layer hides it on screen and draws a snapshot of it inside
 * the map's frame. Moving the marker never re-snapshots; content that renders differently does
 * (`sameLook`), and so do touches, for pressed feedback. Elsewhere it is a plain `MarkerView`.
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
  const { layer, view } = useInMapLayer()
  const [lng, lat] = coordinate
  useLayoutEffect(() => {
    if (!layer) return
    const tag = findNodeHandle(ref.current)
    if (tag != null) markerLayerChannel.set(key, tag, [lng, lat], burstMs, !view)
  }, [key, layer, view, lng, lat, burstMs])
  useEffect(() => () => markerLayerChannel.remove(key), [key])
  return (
    <MarkerView coordinate={coordinate} allowOverlap>
      <View
        ref={ref}
        collapsable={false}
        onTouchStart={layer ? refresh : undefined}
        onTouchEnd={layer ? refresh : undefined}
        onTouchCancel={layer ? refresh : undefined}
      >
        <RefreshContext.Provider value={refresh}>
          <MarkerLook onLook={layer ? refresh : undefined}>{children}</MarkerLook>
        </RefreshContext.Provider>
      </View>
    </MarkerView>
  )
}

/** Renders, and so re-snapshots, only when the content would draw differently. */
const MarkerLook = memo(
  function MarkerLook({ onLook, children }: { onLook?: () => void; children: ReactElement }) {
    useLayoutEffect(() => onLook?.())
    return children
  },
  (prev, next) => prev.onLook === next.onLook && sameLook(prev.children, next.children),
)
