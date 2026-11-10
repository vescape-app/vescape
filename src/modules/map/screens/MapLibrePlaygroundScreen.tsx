import { Camera, Map } from '@maplibre/maplibre-react-native'
import { StyleSheet } from 'react-native'

// Spike #642: MapLibre twin of the Mapbox playground, OpenFreeMap style, no key.
const OPENFREEMAP_LIBERTY = 'https://tiles.openfreemap.org/styles/liberty'
const WROCLAW: [number, number] = [17.0385, 51.1079]

export function MapLibrePlaygroundScreen() {
  return (
    <Map style={styles.map} mapStyle={OPENFREEMAP_LIBERTY}>
      <Camera initialViewState={{ center: WROCLAW, zoom: 13 }} />
    </Map>
  )
}

const styles = StyleSheet.create({ map: { flex: 1 } })
