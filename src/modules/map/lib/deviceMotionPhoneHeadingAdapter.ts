import { Platform } from 'react-native'
import { DeviceMotion } from 'expo-sensors'

import type { PhoneHeadingAdapter } from '@/modules/map/lib/phoneHeading'

const HEADING_OFFSET_DEG = Platform.OS === 'ios' ? -90 : 0

export const deviceMotionPhoneHeadingAdapter: PhoneHeadingAdapter = {
  headingOffsetDeg: HEADING_OFFSET_DEG,
  isAvailableAsync: () => DeviceMotion.isAvailableAsync(),
  getPermissionsAsync: () => DeviceMotion.getPermissionsAsync(),
  requestPermissionsAsync: () => DeviceMotion.requestPermissionsAsync(),
  setUpdateInterval: (intervalMs) => DeviceMotion.setUpdateInterval(intervalMs),
  addListener: (listener) => DeviceMotion.addListener(listener),
}
