import { Platform } from 'react-native'
import { DeviceMotion } from 'expo-sensors'

import type { PhoneHeadingAdapter } from '@/modules/map/lib/phoneHeading'

/**
 * `rotation.alpha` has a different zero on each platform, so the raw yaw has to be re-based here.
 *
 * Android reports `-azimuth` from `SensorManager.getOrientation()`, measured from magnetic north to
 * the top edge of the phone — already the bearing we want, so no offset.
 *
 * iOS reports `CMAttitude.yaw` in the `xMagneticNorthZVertical` frame, whose X axis points north.
 * At zero attitude the phone's *right* edge points north and its top points west, so `-yaw` is the
 * bearing of the right edge; the top edge sits 90° counter-clockwise from it.
 */
const HEADING_OFFSET_DEG = Platform.OS === 'ios' ? -90 : 0

export const deviceMotionPhoneHeadingAdapter: PhoneHeadingAdapter = {
  headingOffsetDeg: HEADING_OFFSET_DEG,
  isAvailableAsync: () => DeviceMotion.isAvailableAsync(),
  getPermissionsAsync: () => DeviceMotion.getPermissionsAsync(),
  requestPermissionsAsync: () => DeviceMotion.requestPermissionsAsync(),
  setUpdateInterval: (intervalMs) => DeviceMotion.setUpdateInterval(intervalMs),
  addListener: (listener) => DeviceMotion.addListener(listener),
}
