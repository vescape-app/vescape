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
   * than sending an empty one — the server then treats the client version as unknown.
   */
  fun buildObserveRequest(url: String, appVersion: String): Request {
    val builder = Request.Builder().url(url)
    if (appVersion.isNotEmpty()) {
      builder.header(AppStatusCoordinator.APP_VERSION_HEADER, appVersion)
    }
    return builder.build()
  }

  /** HTTP 426 Upgrade Required — the server's release-block rejection of an app version. */
  const val VERSION_REJECTION_CODE = 426
}
