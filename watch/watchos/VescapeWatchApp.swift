import SwiftUI

@main
struct VescapeWatchApp: App {
  @WKApplicationDelegateAdaptor(WatchAppDelegate.self) private var appDelegate
  @ObservedObject private var link = PhoneLink.shared
  @State private var replayer: FrameReplayer?

  var body: some Scene {
    WindowGroup {
      Group {
#if DEBUG && targetEnvironment(simulator)
        if let state = BatteryComplicationGallery.requestedFixture ?? BatteryComplicationGallery.requested {
          BatteryComplicationGallery(state: state)
        } else {
          mirror
        }
#else
        mirror
#endif
      }
    }
  }

  private var mirror: some View {
    MirrorScreen(link: link)
      .font(WatchTypography.ui(size: 12))
      // @parity /watch/wearos/src/main/java/app/vescape/wear/MainActivity.kt `onStart`
      .onAppear {
        guard let fixture = FrameReplayer.requestedFixture, replayer == nil else { return }
        let replayer = FrameReplayer(link: link)
        link.replayTiltEcho = { [weak replayer] value in replayer?.echoTilt(value) }
        replayer.start(fixture: fixture, group: FrameReplayer.requestedGroup, routeLoading: ProcessInfo.processInfo.arguments.contains("--route-loading"))
        self.replayer = replayer
      }
  }
}
