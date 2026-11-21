import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchRouteMirror.kt `WatchRouteMirror`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchRoutePusher.kt `WatchRoutePusher`
/// @platform-diff Android needs a pusher with a mutex and a generation counter because each
///   `putDataItem` is an async round trip that can land out of order. `updateApplicationContext` is
///   synchronous and latest-value-wins, and `WatchColdState` is the single writer, so ordering is
///   already the call order and there is nothing to serialize. What survives is the *origin commit*
///   rule, which is not about ordering: the origin moves only once the route it belongs to is known
///   to be on the wrist.
final class WatchRouteMirror {
  static let shared = WatchRouteMirror()

  private let lock = NSLock()

  private var committedOrigin: WatchGeoPoint?

  private var desiredOrigin: WatchGeoPoint?

  private var push: (([String: Any]) -> Void)?
  private var spanM: Double?
  private var publishedRoute: WatchMapRoute?
  private var routeId: UInt32 = 0
  private var transferFailed = false
  var desiredRouteId: UInt32 { lock.withLock { routeId } }
  var failed: Bool { lock.withLock { transferFailed } }

  func channelFailed(_ channel: String) {
    guard channel == watchRouteChannel else { return }
    lock.withLock { transferFailed = true }
  }

  var origin: WatchGeoPoint? { lock.withLock { committedOrigin } }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchRouteMirror.kt `mapRoute`
  var mapRoute: WatchMapRoute? { lock.withLock { publishedRoute } }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchRouteMirror.kt `viewportSpanM`
  var viewportSpanM: Double? {
    get { lock.withLock { spanM } }
    set { lock.withLock { spanM = newValue } }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchRouteMirror.kt `attach`
  func attach(to controller: NavigationController, push: @escaping ([String: Any]) -> Void) {
    lock.withLock { self.push = push }
    controller.onPathChange = { [weak self] path in self?.publish(path) }
    publish(controller.currentPath)
  }

  func detach(from controller: NavigationController) {
    controller.onPathChange = nil
    lock.withLock { push = nil }
  }

  func channelDelivered(_ channel: String) {
    guard channel == watchRouteChannel else { return }
    lock.withLock {
      committedOrigin = desiredOrigin
      transferFailed = false
    }
  }

  private func publish(_ path: [(latitude: Double, longitude: Double)]?) {
    let points = (path ?? []).map { WatchGeoPoint(latitude: $0.latitude, longitude: $0.longitude) }
    let payload = WatchRouteCodec.payload(points: points)
    let mapRoute = points.count >= 2
      ? WatchMapRoute(points: points.map { WatchMapPosition(latitude: $0.latitude, longitude: $0.longitude) })
      : nil
    let push: (([String: Any]) -> Void)? = lock.withLock {
      routeId = (payload[WatchRouteKey.points] as? Data).map(WatchRouteStatusCodec.routeId) ?? 0
      transferFailed = false
      desiredOrigin = WatchRouteCodec.origin(points: points)
      publishedRoute = mapRoute
      return self.push
    }
    push?(payload)
  }
}
