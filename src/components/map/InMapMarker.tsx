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

const SNAPSHOT_BURST_MS = 300

const RefreshContext = createContext<() => void>(() => {})

export function useInMapMarkerRefresh() {
  return useContext(RefreshContext)
}

export function InMapMarker({
  coordinate,
  animationMs = 0,
  children,
}: {
  coordinate: [number, number]
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

const MarkerLook = memo(
  function MarkerLook({ onLook, children }: { onLook?: () => void; children: ReactElement }) {
    useLayoutEffect(() => onLook?.())
    return children
  },
  (prev, next) => prev.onLook === next.onLook && sameLook(prev.children, next.children),
)
