package expo.modules.vescapecore

import expo.modules.vescapecore.appstatus.AppStatusCoordinator
import okhttp3.Request

/**
 * The Group Ride Online Capability contract with the relay: what an observe upgrade carries, and
 * how the server rejects a blocked app version. Kept out of [GroupRideObserver] so it is testable
 * without okhttp's `Handler`/socket glue — the gate *decisions* themselves are one-liners over the
 * observer's own socket state and live inline there.
 *
 * @parity /modules/vescape-core/ios/groupride/GroupRideOnlineGate.swift
 */
internal object GroupRideOnlineGate {
  /**
   * Observe-socket upgrade request, stamped with the installed marketing version so the server can
   * resolve its Release Policy. A blank version (unreadable package info) omits the header rather
   * than sending an empty one — the server then treats the client version as unknown. A
   * [deviceToken] names the Account for the public ride; without one rooms still work and the
   * relay refuses public messages.
   */
  fun buildObserveRequest(url: String, appVersion: String, deviceToken: String? = null): Request {
    val builder = Request.Builder().url(url)
    if (appVersion.isNotEmpty()) {
      builder.header(AppStatusCoordinator.APP_VERSION_HEADER, appVersion)
    }
    if (!deviceToken.isNullOrEmpty()) builder.header("Authorization", "Bearer $deviceToken")
    return builder.build()
  }

  /**
   * The relay socket endpoint on the backend origin, for a public ride the native side starts on its
   * own (board connect with the app in the background).
   *
   * @parity /src/config/server.ts `toGroupRideWebSocketUrl`
   */
  fun webSocketUrl(serverBaseUrl: String): String =
    serverBaseUrl.replaceFirst(Regex("^http"), "ws").trimEnd('/') + "/ws/group-rides"

  /** HTTP 426 Upgrade Required — the server's release-block rejection of an app version. */
  const val VERSION_REJECTION_CODE = 426
}
