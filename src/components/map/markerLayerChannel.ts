interface MarkerEntry {
  tag: number
  lngLat: [number, number]
  version: number
  burstMs: number
  /** Native hides the marker view on screen, leaving it laid out and touchable. */
  hidden: boolean
}

type Sink = (values: number[]) => void

/**
 * Hands the in-map markers to the camera, which owns the native call. Every change of any marker
 * is batched into one call per JS tick carrying the whole list, in mount order, which is the draw
 * order.
 *
 * @parity /node_modules/@rnmapbox/maps/android/src/main/java/com/rnmapbox/rnmbx/components/camera/RNMBXMarkerSprites.kt
 * @parity /node_modules/@rnmapbox/maps/ios/RNMBX/RNMBXMarkerSprites.swift
 */
function createMarkerLayerChannel() {
  let sink: Sink | null = null
  const entries = new Map<object, MarkerEntry>()
  let version = 0
  let scheduled = false
  const flush = () => {
    scheduled = false
    if (!sink) return
    const values: number[] = []
    for (const entry of entries.values()) {
      values.push(
        entry.tag,
        entry.lngLat[0],
        entry.lngLat[1],
        entry.version,
        entry.burstMs,
        entry.hidden ? 1 : 0,
      )
    }
    sink(values)
  }
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(flush)
  }
  return {
    attach(next: Sink | null) {
      sink = next
      flush()
    },
    /** Places a marker. Only a new view is snapshotted; moving one only moves its sprite. */
    set(key: object, tag: number, lngLat: [number, number], burstMs: number, hidden: boolean) {
      const entry = entries.get(key)
      if (entry && entry.tag === tag) {
        entry.lngLat = lngLat
        entry.burstMs = burstMs
        entry.hidden = hidden
      } else {
        entries.set(key, { tag, lngLat, version: ++version, burstMs, hidden })
      }
      schedule()
    },
    /** A new version makes native snapshot the view again, then every frame for `burstMs`. */
    refresh(key: object) {
      const entry = entries.get(key)
      if (!entry) return
      entry.version = ++version
      schedule()
    },
    remove(key: object) {
      if (entries.delete(key)) schedule()
    },
  }
}

export const markerLayerChannel = createMarkerLayerChannel()
