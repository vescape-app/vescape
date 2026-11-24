import AuthenticationServices
import UIKit

@MainActor
final class AppleAuthReauthenticator: NSObject, ASAuthorizationControllerDelegate,
  ASAuthorizationControllerPresentationContextProviding
{
  static let shared = AppleAuthReauthenticator()

  private var continuation: CheckedContinuation<String?, Error>?
  private var activeController: ASAuthorizationController?

  func requestAuthorizationCode() async throws -> String? {
    if continuation != nil {
      throw NSError(
        domain: "VescapeAppleAuth",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Apple authorization is already in progress"]
      )
    }

    return try await withCheckedThrowingContinuation { continuation in
      self.continuation = continuation
      let request = ASAuthorizationAppleIDProvider().createRequest()
      let controller = ASAuthorizationController(authorizationRequests: [request])
      controller.delegate = self
      controller.presentationContextProvider = self
      self.activeController = controller
      controller.performRequests()
    }
  }

  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    if let keyWindow = scenes.flatMap(\.windows).first(where: \.isKeyWindow) {
      return keyWindow
    }
    if let firstWindow = scenes.flatMap(\.windows).first {
      return firstWindow
    }
    return UIWindow()
  }

  nonisolated func authorizationController(
    controller: ASAuthorizationController,
    didCompleteWithAuthorization authorization: ASAuthorization
  ) {
    Task { @MainActor in
      defer {
        self.activeController = nil
        self.continuation = nil
      }
      guard let continuation = self.continuation else { return }
      guard
        let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
        let codeData = credential.authorizationCode,
        let code = String(data: codeData, encoding: .utf8),
        !code.isEmpty
      else {
        continuation.resume(
          throwing: NSError(
            domain: "VescapeAppleAuth",
            code: 2,
            userInfo: [NSLocalizedDescriptionKey: "Apple authorization code was missing"]
          )
        )
        return
      }
      continuation.resume(returning: code)
    }
  }

  nonisolated func authorizationController(
    controller: ASAuthorizationController,
    didCompleteWithError error: Error
  ) {
    Task { @MainActor in
      defer {
        self.activeController = nil
        self.continuation = nil
      }
      guard let continuation = self.continuation else { return }
      if let authError = error as? ASAuthorizationError, authError.code == .canceled {
        continuation.resume(returning: nil)
        return
      }
      continuation.resume(throwing: error)
    }
  }
}
