import { Linking, Platform, Share } from 'react-native'

import type { MapSelection } from '@/modules/map/lib/mapSelection'
import {
  androidMapLocationUrl,
  sharedLocationMessage,
  type SharedLocation,
} from '@/modules/map/lib/sharedLocation'

/**
 * The shareable form of whatever the rider has selected. A dropped pin has no name worth sending —
 * its title is Vescape's own wording for "nothing was hit", which would arrive in the other app as
 * a place called "Dropped pin".
 */
export function sharedLocationFromSelection(selection: MapSelection): SharedLocation {
  return {
    latitude: selection.latitude,
    longitude: selection.longitude,
    name: selection.type === 'coordinate' ? null : selection.title.trim() || null,
  }
}

/**
 * Hands a coordinate to the system share sheet. A dismissed sheet and a failed one look the same
 * from here and both mean the rider is still on the map with nothing changed, so neither is worth
 * a message.
 */
export async function shareLocation(location: SharedLocation): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      await Linking.openURL(androidMapLocationUrl(location))
      return
    }
    await Share.share({ message: sharedLocationMessage(location) })
  } catch {
    // Nothing was sent; the map is unchanged.
  }
}
