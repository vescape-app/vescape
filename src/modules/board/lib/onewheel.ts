/**
 * OneWheel (Future Motion) PoC detection. Boards advertise the `e659f300` service and a name
 * like `ow059062`; some firmware trims the advertisement, so the name prefix is the fallback.
 */

// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/ow/OwProtocol.kt `OW_SERVICE_UUID_STRING`
export const OW_SERVICE_UUID = 'e659f300-ea98-11e3-ac10-0800200c9a66'

const OW_NAME_PATTERN = /^ow\d+/i

export function isOneWheelDevice(device: { name: string; serviceUUIDs: string[] }): boolean {
  if (device.serviceUUIDs.some((uuid) => uuid.toLowerCase() === OW_SERVICE_UUID)) return true
  return OW_NAME_PATTERN.test(device.name)
}
