import XCTest
@testable import VescapeCore

final class SharedLocationLinkResolverTests: XCTestCase {
  func testFollowsPlatformRedirectChainThenExtractsGoogleInitializationState() async throws {
    final class Requests {
      var values: [(String, Bool)] = []
    }
    let requests = Requests()
    let resolver = SharedLocationLinkResolver { url, follows, _, _ in
      requests.values.append((url, follows))
      switch requests.values.count {
      case 1:
        return SharedLocationHTTPResponse(url: url, location: "https://maps.google.com/first", body: "")
      case 2:
        return SharedLocationHTTPResponse(
          url: url,
          location: "/maps/place/G%C3%B3rka+Szczepi%C5%84ska/data=id",
          body: ""
        )
      default:
        return SharedLocationHTTPResponse(
          url: url,
          location: nil,
          body: "window.APP_INITIALIZATION_STATE=[[[0,16.941056,51.1246336"
        )
      }
    }

    let result = try await resolver.resolve("https://maps.app.goo.gl/example")

    XCTAssertEqual(result?.latitude, 51.1246336)
    XCTAssertEqual(result?.longitude, 16.941056)
    XCTAssertEqual(result?.name, "Górka Szczepińska")
    XCTAssertEqual(requests.values.map(\.1), [false, false, true])
  }

  func testUnwrapsGoogleConsentRedirectAndSendsConsentCookie() async throws {
    final class Requests {
      var values: [(String, String?)] = []
    }
    let requests = Requests()
    let destination = "https://www.google.com/maps/place/Target"
    let encodedDestination = destination.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
    let resolver = SharedLocationLinkResolver { url, _, _, cookie in
      requests.values.append((url, cookie))
      switch requests.values.count {
      case 1:
        return SharedLocationHTTPResponse(url: url, location: destination, body: "")
      case 2:
        return SharedLocationHTTPResponse(
          url: url,
          location: "https://consent.google.com/ml?continue=\(encodedDestination)",
          body: ""
        )
      default:
        return SharedLocationHTTPResponse(
          url: url,
          location: nil,
          body: "window.APP_INITIALIZATION_STATE=[[[0,16.941056,51.1246336"
        )
      }
    }

    let result = try await resolver.resolve("https://maps.app.goo.gl/example")
    XCTAssertEqual(result?.latitude, 51.1246336)
    XCTAssertEqual(requests.values.last?.0, destination)
    XCTAssertEqual(requests.values.last?.1, "SOCS=CAESHAgBEhIaAB; CONSENT=YES+")
  }

  func testRejectsInvalidCoordinates() {
    XCTAssertNil(
      SharedLocationLinkResolver.extract(
        url: "https://google.com/maps/data=!3d95.0!4d201.0",
        body: ""
      )
    )
  }
}
