import Foundation

/// Keeps the wrist's copy of the route in step with the Navigation the rider is following.
///
/// Process scoped on purpose. A route is Navigation truth, not session truth: it is pushed the
/// moment a Navigation is published — cold-start restore included — and cleared when it ends,
/// whether or not a board is connected. The per-fix half of the same picture (where the rider is on
/// that route) rides the Watch Frame lanes instead, measured from `origin`.
///
/// Phone side only. The polyline the wrist actually draws is `WatchRoute.swift`, which is compiled
/// into both targets; this type never leaves the phone.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchRouteMirror.kt `WatchRouteMirror`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchRoutePusher.kt `WatchRoutePusher`
/// @platform-diff Android needs a pusher with a mutex and a generation counter because each
///   `putDataItem` is an async round trip that can land out of order. `updateApplicationContext` is
///   synchronous and latest-value-wins, and `WatchColdState` is the single writer, so ordering is
///   already the call order and there is nothing to serialize. What survives is the *origin commit*
///   rule, which is not about ordering: the origin moves only once the route it belongs to is known
///   to be on the wrist.
final class WatchRouteMirror {
  /// Process singleton — the route must outlive JS runtime reloads, exactly as the Navigation does.
  static let shared = WatchRouteMirror()

  private let lock = NSLock()

  /// Origin of the route the wrist actually holds — the frame's rider lanes are offsets from it.
  ///
  /// Committed only once its push has landed. Anything looser lets the two halves of the wrist
  /// picture disagree: an origin pointing at a route the wrist does not have places the rider off
  /// the drawn line, and that state lasts until the next route change.
  private var committedOrigin: WatchGeoPoint?

  /// Origin of the route the phone last *tried* to push. Promoted to `committedOrigin` by
  /// `channelDelivered`, which is the cold state saying the payload is on the wrist.
  private var desiredOrigin: WatchGeoPoint?

  private var push: (([String: Any]) -> Void)?
  private var spanM: Double?

  var origin: WatchGeoPoint? { lock.withLock { committedOrigin } }

  /// Settled phone-map horizontal viewport span, carried on the next live Watch Frame.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchRouteMirror.kt `viewportSpanM`
  var viewportSpanM: Double? {
    get { lock.withLock { spanM } }
    set { lock.withLock { spanM = newValue } }
  }

  /// Attach to `controller` so every published path lands on the wrist through `push`.
  ///
  /// The current path is pushed straight away rather than waited for. Two reasons, and both are the
  /// clear-vs-restore trap: `restore()` may already have published before this ran, so waiting would
  /// leave a restored route off the wrist until the rider touched it; and with no route at all the
  /// immediate push is the *explicit clear*, which is what stops a reconnecting wrist from
  /// restoring a route the rider cleared in an earlier run of this process' predecessor.
  ///
  /// Idempotent: attaching again over a live mirror keeps the committed origin rather than
  /// orphaning the route already on the wrist.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchRouteMirror.kt `attach`
  func attach(to controller: NavigationController, push: @escaping ([String: Any]) -> Void) {
    lock.withLock { self.push = push }
    controller.onPathChange = { [weak self] path in self?.publish(path) }
    publish(controller.currentPath)
  }

  /// A cold-state channel landed on the wrist. The route channel is the one that moves an origin.
  func channelDelivered(_ channel: String) {
    guard channel == watchRouteChannel else { return }
    lock.withLock { committedOrigin = desiredOrigin }
  }

  private func publish(_ path: [(latitude: Double, longitude: Double)]?) {
    let points = (path ?? []).map { WatchGeoPoint(latitude: $0.latitude, longitude: $0.longitude) }
    let push: (([String: Any]) -> Void)? = lock.withLock {
      // The clear carries a nil origin, so a route that goes away takes the rider lanes with it
      // rather than leaving them measured against a polyline nothing is drawing.
      desiredOrigin = WatchRouteCodec.origin(points: points)
      return self.push
    }
    push?(WatchRouteCodec.payload(points: points))
  }
}
