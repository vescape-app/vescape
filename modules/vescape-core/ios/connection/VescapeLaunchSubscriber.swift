import ExpoModulesCore

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/service/AutoConnectProvider.kt
/// @platform-diff Android's peer is `CoreForegroundService`: the process is kept alive by the
/// service, so it is never relaunched and needs no restoration hook.
public final class VescapeLaunchSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    NSLog("[VescAutoConnect] didFinishLaunchingWithOptions")
    Task { await RiderStatsSender.shared.foreground() }
    BoardSessionController.shared.prepareForLaunch()
    BoardSessionController.shared.autoConnectSelectedBoard()
    AccessorySessionController.shared.prepareForLaunch()
    BoardSessionController.shared.startWatchMirror()
    return false
  }
}
