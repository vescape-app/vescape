import Network

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/NetworkWatch.kt `watchNetwork`
func watchNetwork(_ onNewNetwork: @escaping () -> Void) -> () -> Void {
  let monitor = NWPathMonitor()
  let seen = SeenNetwork()
  monitor.pathUpdateHandler = { path in
    let primary = path.status == .satisfied ? path.availableInterfaces.first?.name : nil
    let isNew = seen.started && primary != nil && primary != seen.primary
    seen.started = true
    seen.primary = primary
    if isNew { onNewNetwork() }
  }
  monitor.start(queue: DispatchQueue(label: "app.vescape.network-watch"))
  return {
    monitor.pathUpdateHandler = nil
    monitor.cancel()
  }
}

private final class SeenNetwork {
  var started = false
  var primary: String?
}
