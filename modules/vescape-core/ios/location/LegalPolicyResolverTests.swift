import XCTest
@testable import VescapeCore

final class LegalPolicyResolverTests: XCTestCase {
  func testCanonicalCatalogAcceptsSupportedCountriesAndRejectsUnsupportedCountries() throws {
    let root = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
    let json = try String(
      contentsOf: root.appendingPathComponent("shared/data/legal-policies.json"),
      encoding: .utf8
    )
    let supported = LegalPolicyResolver.countryCodes(json: json)

    XCTAssertEqual(LegalPolicyResolver.normalizeCountryCode("pl", supported: supported), "PL")
    XCTAssertNil(LegalPolicyResolver.normalizeCountryCode("US", supported: supported))
    XCTAssertNil(LegalPolicyResolver.normalizeCountryCode(nil, supported: supported))
  }

  func testDerivesWarningFromReferenceSpeedWhenJurisdictionHasNoLegalLimit() {
    let rows = LegalPolicyCatalog.parse(
      json: #"[{"code":"CY","legalSpeedKmh":null,"warningSpeedKmh":null,"referenceSpeedKmh":20}]"#
    )

    XCTAssertEqual(rows["CY"], LegalPolicySpeeds(warningSpeedKmh: 15, limitSpeedKmh: 20))
  }

  func testFailedCatalogAndEmptyGeocoderAreUnavailable() async {
    let failedCatalog = LegalPolicyCatalog(loader: { throw CocoaError(.fileNoSuchFile) })
    let failed = LegalPolicyResolver(catalog: failedCatalog, countryLookup: { _, _ in "PL" })
    let failedResult = await failed.resolve(latitude: 1, longitude: 2)
    XCTAssertEqual(failedResult, .unavailable)

    let validCatalog = LegalPolicyCatalog(loader: {
      #"[{"code":"PL","legalSpeedKmh":25,"warningSpeedKmh":20}]"#
    })
    let empty = LegalPolicyResolver(catalog: validCatalog, countryLookup: { _, _ in nil })
    let emptyResult = await empty.resolve(latitude: 1, longitude: 2)
    XCTAssertEqual(emptyResult, .unavailable)
  }

  func testCancellationHasItsOwnOutcome() async {
    let catalog = LegalPolicyCatalog(loader: {
      #"[{"code":"PL","legalSpeedKmh":25,"warningSpeedKmh":20}]"#
    })
    let resolver = LegalPolicyResolver(catalog: catalog, countryLookup: { _, _ in
      throw CancellationError()
    })
    let result = await resolver.resolve(latitude: 1, longitude: 2)
    XCTAssertEqual(result, .cancelled)
  }
}
