import UIKit

/// Animated launch splash. A copy of the launch storyboard goes over the app window as soon as the
/// window becomes key, long before JS loads, and animates the logo until JS calls `hide()`.
///
/// The static launch storyboard hands off to an identical overlay, so motion starts during the
/// native launch phase instead of after JS boots. `expo-splash-screen`'s own loading view sits
/// underneath and is hidden by JS.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/splash/LaunchSplash.kt
@MainActor
enum LaunchSplash {
  private static let pulseScale: CGFloat = 1.04
  private static let pulseDuration: TimeInterval = 1.2
  private static let exitFadeDuration: TimeInterval = 0.25
  /// Helper windows from the dev client that must not host the splash.
  private static let ignoredRootPrefixes = ["EXDevLauncher", "RCTLogBox", "RCTDevMenu", "EXDevMenu"]

  private static var observer: NSObjectProtocol?
  private static var overlay: UIView?
  private static var dismissed = false

  /// Called from `didFinishLaunchingWithOptions`, before the app window exists.
  static func install() {
    guard observer == nil, !dismissed else { return }
    observer = NotificationCenter.default.addObserver(
      forName: UIWindow.didBecomeKeyNotification,
      object: nil,
      queue: .main
    ) { note in
      MainActor.assumeIsolated {
        guard let window = note.object as? UIWindow, hostsApp(window) else { return }
        if let observer { NotificationCenter.default.removeObserver(observer) }
        observer = nil
        attach(to: window)
      }
    }
  }

  static func hide() {
    dismissed = true
    if let observer { NotificationCenter.default.removeObserver(observer) }
    observer = nil
    guard let view = overlay else { return }
    overlay = nil
    UIView.animate(withDuration: exitFadeDuration) {
      view.alpha = 0
    } completion: { _ in
      view.removeFromSuperview()
    }
  }

  private static func attach(to window: UIWindow) {
    guard
      !dismissed,
      let name = Bundle.main.object(forInfoDictionaryKey: "UILaunchStoryboardName") as? String,
      Bundle.main.path(forResource: name, ofType: "storyboardc") != nil,
      let splash = UIStoryboard(name: name, bundle: nil).instantiateInitialViewController()?.view
    else { return }

    splash.frame = window.bounds
    splash.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    splash.isUserInteractionEnabled = true // swallow touches while visible
    window.addSubview(splash)
    overlay = splash

    guard let logo = splash.subviews.first(where: { $0 is UIImageView }) else { return }
    UIView.animate(
      withDuration: pulseDuration,
      delay: 0,
      options: [.autoreverse, .repeat, .curveEaseInOut, .allowUserInteraction]
    ) {
      logo.transform = CGAffineTransform(scaleX: pulseScale, y: pulseScale)
    }
  }

  private static func hostsApp(_ window: UIWindow) -> Bool {
    guard let root = window.rootViewController else { return false }
    let name = String(describing: type(of: root))
    return !ignoredRootPrefixes.contains { name.hasPrefix($0) }
  }
}
