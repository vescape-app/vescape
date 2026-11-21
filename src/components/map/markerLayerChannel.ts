interface MarkerEntry {
  tag: number
  lngLat: [number, number]
  version: number
  burstMs: number
  hidden: boolean
}

type Sink = (values: number[]) => void

/**
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
