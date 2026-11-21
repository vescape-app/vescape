/**
 * @parity /modules/vescape-core/ios/appstatus/AppStatusCoordinator.swift `serverBaseUrl`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatusCoordinator.kt `serverBaseUrl`
 */
export const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL ?? 'https://api.vescape.app'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/GroupRideOnlineGate.kt `webSocketUrl`
 * @parity /modules/vescape-core/ios/groupride/GroupRideOnlineGate.swift `webSocketUrl`
 */
export function toGroupRideWebSocketUrl(serverUrl: string) {
  return `${serverUrl.replace(/^http/, 'ws').replace(/\/+$/, '')}/ws/group-rides`
}

export const SERVER_WS_URL = toGroupRideWebSocketUrl(SERVER_URL)
