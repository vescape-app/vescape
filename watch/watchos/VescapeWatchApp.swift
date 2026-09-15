import SwiftUI

/// Entry point of the watchOS Mirror. The durable source lives here in `watch/watchos/` and is
/// injected into the generated Xcode project by `plugins/withWatchOS.ts` on every prebuild
/// (ADR-0019) — the peer of `watch/wearos/` on Android.
@main
struct VescapeWatchApp: App {
  @StateObject private var link = PhoneLink()
  @State private var replayer: FrameReplayer?

  var body: some Scene {
    WindowGroup {
      MirrorScreen(link: link)
        // Replay owns its inputs; live phone context must not overwrite the fixtures.
        // @parity /watch/wearos/src/main/java/app/vescape/wear/MainActivity.kt `onStart`
        .onAppear {
          // Simulator only, and only when asked for by launch argument. On a watch and on a device
          // build `requestedFixture` is nil and this is not reachable.
          if let fixture = FrameReplayer.requestedFixture {
            guard replayer == nil else { return }
            let replayer = FrameReplayer(link: link)
            replayer.start(fixture: fixture)
            self.replayer = replayer
          } else {
            link.activate()
          }
        }
    }
  }
}
