import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/connection/TransportDetectionTest.kt
final class TransportDetectionTests: XCTestCase {
  private func probe(
    _ transport: BoardTransport,
    confirmed: Bool,
    hasBms: Bool = false,
    vescFirmwareVersion: String? = nil,
    refloatVersion: String? = nil,
    refloatBaseVersion: String? = nil
  ) -> TransportDetection.Probe {
    TransportDetection.Probe(
      transport: transport,
      confirmed: confirmed,
      hasBms: hasBms,
      vescFirmwareVersion: vescFirmwareVersion,
      refloatVersion: refloatVersion,
      refloatBaseVersion: refloatBaseVersion
    )
  }

  func testProbesDirectWithNoCanResponders() {
    XCTAssertEqual([.direct], TransportDetection.candidatesToProbe([]))
  }

  func testProbesDirectFirstThenRespondersAscending() {
    XCTAssertEqual(
      [.direct, .can(12), .can(43)],
      TransportDetection.candidatesToProbe([43, 12])
    )
  }

  func testDedupesRepeatedResponderIds() {
    XCTAssertEqual([.direct, .can(7)], TransportDetection.candidatesToProbe([7, 7, 7]))
  }

  func testDirectOnlyConfirmedResolvesToDirect() {
    let result = TransportDetection.resolve([probe(.direct, confirmed: true)])
    XCTAssertEqual([.direct], result.candidates.map { $0.transport })
    XCTAssertEqual(.resolved(.direct), result.outcome)
    XCTAssertEqual(.direct, result.resolvedTransport)
  }

  func testCanOnlyConfirmedResolvesToThatCanId() {
    let result = TransportDetection.resolve([
      probe(.direct, confirmed: false),
      probe(.can(43), confirmed: true),
    ])
    XCTAssertEqual([.can(43)], result.candidates.map { $0.transport })
    XCTAssertEqual(.resolved(.can(43)), result.outcome)
    XCTAssertEqual(.can(43), result.resolvedTransport)
  }

  func testMultipleValidCanIdsNeedPickInProbeOrder() {
    let result = TransportDetection.resolve([
      probe(.direct, confirmed: false),
      probe(.can(12), confirmed: true),
      probe(.can(43), confirmed: true),
    ])
    XCTAssertEqual([.can(12), .can(43)], result.candidates.map { $0.transport })
    XCTAssertEqual(.needsPick([.can(12), .can(43)]), result.outcome)
    XCTAssertNil(result.resolvedTransport)
  }

  func testBothDirectAndCanValidNeedPickDirectFirst() {
    let result = TransportDetection.resolve([
      probe(.direct, confirmed: true),
      probe(.can(43), confirmed: true),
    ])
    XCTAssertEqual([.direct, .can(43)], result.candidates.map { $0.transport })
    XCTAssertEqual(.needsPick([.direct, .can(43)]), result.outcome)
  }

  func testNoConfirmedTransportYieldsNone() {
    let result = TransportDetection.resolve([
      probe(.direct, confirmed: false),
      probe(.can(43), confirmed: false),
    ])
    XCTAssertTrue(result.candidates.isEmpty)
    XCTAssertEqual(.none, result.outcome)
    XCTAssertNil(result.resolvedTransport)
  }

  func testEmptyProbeSetYieldsNone() {
    let result = TransportDetection.resolve([])
    XCTAssertTrue(result.candidates.isEmpty)
    XCTAssertEqual(.none, result.outcome)
  }

  func testBmsPresenceCarriedOntoConfirmedCandidate() {
    let result = TransportDetection.resolve([probe(.direct, confirmed: true, hasBms: true)])
    XCTAssertEqual([TransportDetection.Candidate(transport: .direct, hasBms: true)], result.candidates)
  }

  func testBmsCapabilityTrackedPerCandidateOnMultiNodeBus() {
    let result = TransportDetection.resolve([
      probe(.direct, confirmed: true, hasBms: false),
      probe(.can(43), confirmed: true, hasBms: true),
    ])
    XCTAssertEqual(
      [
        TransportDetection.Candidate(transport: .direct, hasBms: false),
        TransportDetection.Candidate(transport: .can(43), hasBms: true),
      ],
      result.candidates
    )
  }

  func testBmsOnUnconfirmedTransportDroppedWithIt() {
    let result = TransportDetection.resolve([
      probe(.direct, confirmed: false, hasBms: true),
      probe(.can(7), confirmed: true, hasBms: false),
    ])
    XCTAssertEqual([TransportDetection.Candidate(transport: .can(7), hasBms: false)], result.candidates)
  }

  func testFirmwareIdentityCarriedOntoConfirmedCandidates() {
    let result = TransportDetection.resolve([
      probe(
        .can(7),
        confirmed: true,
        hasBms: true,
        vescFirmwareVersion: "FW 6.05",
        refloatVersion: "Refloat 1.3.0-preview2",
        refloatBaseVersion: "1.3.0"
      ),
    ])

    XCTAssertEqual(
      [
        TransportDetection.Candidate(
          transport: .can(7),
          hasBms: true,
          vescFirmwareVersion: "FW 6.05",
          refloatVersion: "Refloat 1.3.0-preview2",
          refloatBaseVersion: "1.3.0"
        ),
      ],
      result.candidates
    )
  }

  func testMissingFirmwareIdentityDoesNotDropTelemetryConfirmedCandidate() {
    let result = TransportDetection.resolve([probe(.direct, confirmed: true, hasBms: false)])

    XCTAssertEqual(.resolved(.direct), result.outcome)
    XCTAssertEqual(1, result.candidates.count)
    XCTAssertNil(result.candidates[0].vescFirmwareVersion)
    XCTAssertNil(result.candidates[0].refloatVersion)
    XCTAssertNil(result.candidates[0].refloatBaseVersion)
  }
}
