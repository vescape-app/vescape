import Foundation

struct ResolvedSharedLocation {
  let latitude: Double
  let longitude: Double
  let name: String?

  var bridgeValue: [String: Any?] {
    ["latitude": latitude, "longitude": longitude, "name": name]
  }
}

struct SharedLocationHTTPResponse {
  let url: String
  let location: String?
  let body: String
  let status: Int

  init(url: String, location: String?, body: String, status: Int = 200) {
    self.url = url
    self.location = location
    self.body = body
    self.status = status
  }
}

private final class RedirectBlockingDelegate: NSObject, URLSessionTaskDelegate {
  func urlSession(
    _: URLSession,
    task _: URLSessionTask,
    willPerformHTTPRedirection _: HTTPURLResponse,
    newRequest _: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }
}

/**
 Resolves opaque map share links without a Maps API. Google uses different redirect chains for
 Android and iOS shares, so redirects are deliberately stepped before the final browser-like GET.

 @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sharing/SharedLocationLinkResolver.kt
 @parity /modules/vescape-core/src/index.ts `resolveSharedLocationLink`
 */
final class SharedLocationLinkResolver {
  typealias Request = (String, Bool, String, String?) async throws -> SharedLocationHTTPResponse

  private let request: Request

  init(request: @escaping Request = SharedLocationLinkResolver.defaultRequest) {
    self.request = request
  }

  func resolve(_ link: String) async throws -> ResolvedSharedLocation? {
    var current = link
    for _ in 0..<2 {
      var response = try await request(current, false, Self.simpleUserAgent, nil)
      var attempts = 1
      while response.status == 404 && attempts < 5 {
        try await Task.sleep(for: .milliseconds(250))
        response = try await request(current, false, Self.simpleUserAgent, nil)
        attempts += 1
      }
      guard let location = response.location,
            let destination = URL(string: location, relativeTo: URL(string: current))?.absoluteURL.absoluteString
      else {
        return Self.extract(url: current, body: response.body)
      }
      current = destination
    }

    let consentDestination = Self.googleConsentDestination(current)
    if let consentDestination { current = consentDestination }
    let response = try await request(
      current,
      true,
      Self.browserUserAgent,
      consentDestination == nil ? nil : Self.googleConsentCookie
    )
    return Self.extract(url: response.url, body: response.body)
  }

  static func extract(url: String, body: String) -> ResolvedSharedLocation? {
    if let coordinate = coordinate(in: url, pattern: pinPattern, reversed: false) {
      return coordinate.withName(from: url)
    }
    if let coordinate = coordinate(in: url, pattern: routePattern, reversed: false) {
      return coordinate.withName(from: url)
    }
    if let coordinate = coordinate(in: url, pattern: osmMarkerPattern, reversed: false) {
      return coordinate.withName(from: url)
    }
    if let coordinate = coordinate(in: url, pattern: queryPattern, reversed: false) {
      return coordinate.withName(from: url)
    }
    if let coordinate = coordinate(in: url, pattern: viewportPattern, reversed: false) {
      return coordinate.withName(from: url)
    }
    if let coordinate = coordinate(in: body, pattern: initialStatePattern, reversed: true) {
      return coordinate.withName(from: url)
    }
    if let coordinate = coordinate(in: body, pattern: staticCenterPattern, reversed: false) {
      return coordinate.withName(from: url)
    }
    return nil
  }

  private static let simpleUserAgent = "Mozilla/5.0"
  private static let googleConsentCookie = "SOCS=CAESHAgBEhIaAB; CONSENT=YES+"
  private static let browserUserAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  private static let pinPattern = #"!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)"#
  private static let routePattern = #"!\d+d(-?\d+(?:\.\d+)?)!\d+d(-?\d+(?:\.\d+)?)"#
  private static let initialStatePattern =
    #"window\.APP_INITIALIZATION_STATE=\[\[\[-?\d+(?:\.\d+)?,\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)"#
  private static let staticCenterPattern =
    #"(?:center=|center%3D)(-?\d+(?:\.\d+)?)(?:%2C|,)(-?\d+(?:\.\d+)?)"#
  private static let queryPattern =
    #"[?&](?:q|query|ll|sll|daddr|saddr|destination|center|coordinate)=(?:loc:)?(-?\d+(?:\.\d+)?)(?:%2C|,)(-?\d+(?:\.\d+)?)"#
  private static let osmMarkerPattern =
    #"[?&]mlat=(-?\d+(?:\.\d+)?)(?:&|&amp;)mlon=(-?\d+(?:\.\d+)?)"#
  private static let viewportPattern = #"@(-?\d+(?:\.\d+)?)(?:%2C|,)(-?\d+(?:\.\d+)?)"#

  private static func coordinate(
    in value: String,
    pattern: String,
    reversed: Bool
  ) -> ResolvedSharedLocation? {
    guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
          let match = regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)),
          let firstRange = Range(match.range(at: 1), in: value),
          let secondRange = Range(match.range(at: 2), in: value),
          let first = Double(value[firstRange]),
          let second = Double(value[secondRange])
    else { return nil }
    let latitude = reversed ? second : first
    let longitude = reversed ? first : second
    guard (-90...90).contains(latitude), (-180...180).contains(longitude) else { return nil }
    return ResolvedSharedLocation(latitude: latitude, longitude: longitude, name: nil)
  }

  private static func defaultRequest(
    _ url: String,
    _ followRedirects: Bool,
    _ userAgent: String,
    _ cookie: String?
  ) async throws -> SharedLocationHTTPResponse {
    guard let requestURL = URL(string: url) else { throw URLError(.badURL) }
    var urlRequest = URLRequest(url: requestURL)
    urlRequest.setValue(userAgent, forHTTPHeaderField: "User-Agent")
    if let cookie { urlRequest.setValue(cookie, forHTTPHeaderField: "Cookie") }
    let session = followRedirects
      ? URLSession.shared
      : URLSession(configuration: .ephemeral, delegate: RedirectBlockingDelegate(), delegateQueue: nil)
    let (data, response) = try await session.data(for: urlRequest)
    guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
    return SharedLocationHTTPResponse(
      url: http.url?.absoluteString ?? url,
      location: http.value(forHTTPHeaderField: "Location"),
      body: String(decoding: data, as: UTF8.self),
      status: http.statusCode
    )
  }

  private static func googleConsentDestination(_ value: String) -> String? {
    guard let components = URLComponents(string: value),
          components.host?.lowercased() == "consent.google.com"
    else { return nil }
    return components.queryItems?.first(where: { $0.name == "continue" })?.value
  }
}

private extension ResolvedSharedLocation {
  func withName(from url: String) -> ResolvedSharedLocation {
    guard let regex = try? NSRegularExpression(pattern: #"/maps/place/([^/@?#]+)"#, options: [.caseInsensitive]),
          let match = regex.firstMatch(in: url, range: NSRange(url.startIndex..., in: url)),
          let range = Range(match.range(at: 1), in: url)
    else { return self }
    let encoded = String(url[range]).replacingOccurrences(of: "+", with: " ")
    let decoded = encoded.removingPercentEncoding ?? encoded
    return ResolvedSharedLocation(latitude: latitude, longitude: longitude, name: decoded)
  }
}
