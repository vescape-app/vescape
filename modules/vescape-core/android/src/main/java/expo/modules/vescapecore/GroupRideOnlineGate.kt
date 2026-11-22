package expo.modules.vescapecore

import expo.modules.vescapecore.appstatus.AppStatusCoordinator
import okhttp3.Request

/**
 * @parity /modules/vescape-core/ios/groupride/GroupRideOnlineGate.swift
 */
internal object GroupRideOnlineGate {
  fun buildObserveRequest(url: String, appVersion: String, deviceToken: String? = null): Request {
    val builder = Request.Builder().url(url)
    if (appVersion.isNotEmpty()) {
      builder.header(AppStatusCoordinator.APP_VERSION_HEADER, appVersion)
    }
    if (!deviceToken.isNullOrEmpty()) builder.header("Authorization", "Bearer $deviceToken")
    return builder.build()
  }

  /**
   * @parity /src/config/server.ts `toGroupRideWebSocketUrl`
   */
  fun webSocketUrl(serverBaseUrl: String): String =
    serverBaseUrl.replaceFirst(Regex("^http"), "ws").trimEnd('/') + "/ws/group-rides"

  const val VERSION_REJECTION_CODE = 426
}
