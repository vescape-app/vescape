import CoreLocation
import Foundation

internal struct LegalPolicySpeeds: Equatable {
  let warningSpeedKmh: Double
  let limitSpeedKmh: Double
}

/// Bundled Legal Policy lookup used by jurisdiction resolution and Legal Mode alert synthesis.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/LegalPolicyCatalog.kt
internal final class LegalPolicyCatalog {
  private let loader: () throws -> String
  private var loadFailed = false
  private lazy var rows: [String: LegalPolicySpeeds] = {
    do {
      let parsed = Self.parse(json: try loader())
      guard !parsed.isEmpty else { throw CocoaError(.fileReadCorruptFile) }
      return parsed
    } catch {
      loadFailed = true
      UnexpectedNativeError.report(operation: "legal_policy_catalog_load", category: "bundled_asset", error: error)
      return [:]
    }
  }()

  init(loader: @escaping () throws -> String = LegalPolicyCatalog.bundledJson) {
    self.loader = loader
  }

  var countryCodes: Set<String> { Set(rows.keys) }
  var isAvailable: Bool { _ = rows; return !loadFailed }

  func speeds(countryCode: String) -> LegalPolicySpeeds? {
    rows[countryCode.trimmingCharacters(in: .whitespaces).uppercased()]
  }

  static func parse(json: String) -> [String: LegalPolicySpeeds] {
    guard
      let data = json.data(using: .utf8),
      // intentional-suppression: malformed bundled rows are excluded from the catalog
      let values = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    else { return [:] }

    var policies: [String: LegalPolicySpeeds] = [:]
    for value in values {
      guard let rawCode = value["code"] as? String else { continue }
      let code = rawCode.trimmingCharacters(in: .whitespaces).uppercased()
      guard code.count == 2 else { continue }
      let legal = number(value["legalSpeedKmh"])
      let reference = number(value["referenceSpeedKmh"])
      let limit = positive(legal) ?? positive(reference)
      let warning = positive(number(value["warningSpeedKmh"])) ?? limit.map { $0 - 5 }.flatMap(positive)
      guard let limit, let warning, warning < limit else { continue }
      policies[code] = LegalPolicySpeeds(warningSpeedKmh: warning, limitSpeedKmh: limit)
    }
    return policies
  }

  private static func number(_ value: Any?) -> Double? {
    (value as? NSNumber)?.doubleValue
  }

  private static func positive(_ value: Double?) -> Double? {
    guard let value, value.isFinite, value > 0 else { return nil }
    return value
  }

  private static func bundledJson() throws -> String {
    let moduleBundle = Bundle(for: LegalPolicyCatalog.self)
    let url =
      moduleBundle.url(forResource: "legal-policies", withExtension: "json")
      ?? moduleBundle.url(forResource: "VescapeCoreAssets", withExtension: "bundle").flatMap {
        Bundle(url: $0)?.url(forResource: "legal-policies", withExtension: "json")
      }
    guard let url else { throw CocoaError(.fileNoSuchFile) }
    return try String(contentsOf: url, encoding: .utf8)
  }
}

internal enum LegalPolicyResolution: Equatable {
  case resolved(String?)
  case unavailable
  case cancelled
}

/// Native OS reverse geocoder constrained by the bundled Legal Policy catalog.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/LegalPolicyResolver.kt
internal final class LegalPolicyResolver {
  private let catalog: LegalPolicyCatalog
  private let countryLookup: (Double, Double) async throws -> String?

  init(
    catalog: LegalPolicyCatalog = LegalPolicyCatalog(),
    countryLookup: @escaping (Double, Double) async throws -> String? = { latitude, longitude in
      try await CLGeocoder().reverseGeocodeLocation(
        CLLocation(latitude: latitude, longitude: longitude)
      ).first?.isoCountryCode
    }
  ) {
    self.catalog = catalog
    self.countryLookup = countryLookup
  }

  func resolve(latitude: Double, longitude: Double) async -> LegalPolicyResolution {
    do {
      let rawCode = try await countryLookup(latitude, longitude)
      guard catalog.isAvailable, let rawCode else {
        return .unavailable
      }
      return .resolved(Self.normalizeCountryCode(rawCode, supported: catalog.countryCodes))
    } catch {
      if error is CancellationError || Task.isCancelled { return .cancelled }
      return .unavailable
    }
  }

  static func countryCodes(json: String) -> Set<String> {
    Set(LegalPolicyCatalog.parse(json: json).keys)
  }

  static func normalizeCountryCode(_ raw: String?, supported: Set<String>) -> String? {
    guard let code = raw?.trimmingCharacters(in: .whitespaces).uppercased() else { return nil }
    return supported.contains(code) ? code : nil
  }
}
