import SwiftUI

/// Entry point of the watchOS Mirror. The durable source lives here in `watch/watchos/` and is
/// injected into the generated Xcode project by `plugins/withWatchOS.ts` on every prebuild
/// (ADR-0019) — the peer of `watch/wearos/` on Android.
@main
struct VescapeWatchApp: App {
  @StateObject private var link = PhoneLink()

  var body: some Scene {
    WindowGroup {
      MirrorView(link: link)
        // Activated once, on appearance, and never torn down: `WCSession` is owned by the system
        // and the wrist has nothing else to do with its lifetime.
        .onAppear { link.activate() }
    }
  }
}
