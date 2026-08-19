import UIKit
import UniformTypeIdentifiers

/**
 * Vescape's entry in the iOS share sheet. It shows no interface and makes no decision about the
 * payload: it reads whatever text or URL the sharing app attached and opens the app on the one
 * link both platforms deliver a shared location through, leaving Vescape to decide what it means.
 *
 * @parity /src/modules/map/screens/SharedLocationScreen.tsx
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sharing/ShareTargetActivity.kt
 * @platform-diff An extension is the only way a share reaches an iOS app; Android receives the
 * share intent in the app process. Both end at the same `vescape://shared-location` link.
 */
class ShareLocationViewController: UIViewController {
  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    Task {
      let payload = await readPayload()
      openApp(with: payload)
      extensionContext?.completeRequest(returningItems: nil)
    }
  }

  /// The first attachment that carries text, in the order worth reading. An empty result is still
  /// forwarded: "nothing usable was shared" is an answer the rider is owed, said on the map.
  private func readPayload() async -> String {
    let attachments = (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
      .flatMap { $0.attachments ?? [] }
    for type in [UTType.url, UTType.plainText] {
      for attachment in attachments
      where attachment.hasItemConformingToTypeIdentifier(type.identifier) {
        let item = try? await attachment.loadItem(forTypeIdentifier: type.identifier)
        if let url = item as? URL { return url.absoluteString }
        if let string = item as? String, !string.isEmpty { return string }
      }
    }
    return ""
  }

  private func openApp(with payload: String) {
    var components = URLComponents()
    components.scheme = "vescape"
    components.host = "shared-location"
    components.queryItems = [URLQueryItem(name: "text", value: payload)]
    guard let url = components.url else { return }

    // An extension cannot call UIApplication.shared; walking the responder chain to whoever does
    // respond to `openURL:` is the supported way out of one.
    var responder: UIResponder? = self
    while let current = responder {
      if let application = current as? UIApplication {
        application.open(url)
        return
      }
      responder = current.next
    }
  }
}
