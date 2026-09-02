import ExpoModulesCore

/// Runs `BoardSessionController.prepareForLaunch()` inside `didFinishLaunchingWithOptions`, which is
/// the only place CoreBluetooth state restoration can be set up from: iOS replays a central's
/// preserved state solely to a central re-created with the same restore identifier during the launch
/// sequence (ADR 0034, #378). The session central is otherwise built lazily on the first JS-driven
/// connect — long after the window has closed.
///
/// Autolinked through `expo-module.config.json` (`appDelegateSubscribers`) rather than an AppDelegate
/// patch, so the hook lives in durable module source instead of the generated `ios/` tree.
///
/// The controller no-ops unless a Board Session was live when the process last ran, so a normal cold
/// start still spins up no BLE.
///
/// Launch auto-connect (#401) hangs off the same hook, deliberately after the restoration prepare:
/// restoration adoption decides first, and auto-connect only starts a session when no live one is
/// being resumed. This is the iOS peer of Android's `AutoConnectProvider`, which fires from a
/// `ContentProvider` at process start — both triggers are process launch, not JS module creation.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/service/AutoConnectProvider.kt
///
/// @platform-diff Android's peer is `CoreForegroundService`: the process is kept alive by the
/// service, so it is never relaunched and needs no restoration hook.
public final class VescapeLaunchSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    NSLog("[VescAutoConnect] didFinishLaunchingWithOptions")
    BoardSessionController.shared.prepareForLaunch()
    BoardSessionController.shared.autoConnectSelectedBoard()
    return false
  }
}
