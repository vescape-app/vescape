import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/alerts/EffectsPacksTest.kt
final class EffectsPacksTests: XCTestCase {
  /// A pack filling only the required slots, without `cue.on` or `cue.off`.
  private let packSlots: Set = ["severity.positive", "severity.info", "severity.warning", "severity.critical"]

  private func lookup(_ slot: String, overrides: Set<String> = []) -> String {
    lookupSlot(slot, hasOverride: { overrides.contains($0) }, packHas: { self.packSlots.contains($0) })
  }

  func testMissingOptionalSlotsFallBackToTheirSeveritySound() {
    XCTAssertEqual(lookup("cue.on"), "severity.positive")
    XCTAssertEqual(lookup("cue.off"), "severity.warning")
  }

  func testOverrideOnTheOptionalSlotWins() {
    XCTAssertEqual(lookup("cue.on", overrides: ["cue.on", "severity.positive"]), "cue.on")
  }

  func testOverrideOnTheFallbackSlotCoversTheMissingCue() {
    XCTAssertEqual(lookup("cue.on", overrides: ["severity.positive"]), "severity.positive")
  }

  func testRemovedCuesPlayFixedSeverities() {
    XCTAssertEqual(appCueSlot("error"), "severity.critical")
    XCTAssertEqual(appCueSlot("groupRide.riderJoined"), "severity.info")
    XCTAssertEqual(appCueSlot("groupRide.riderLeft"), "severity.warning")
    XCTAssertEqual(appCueSlot("groupRide.lost"), "severity.warning")
    XCTAssertEqual(appCueSlot("groupRide.restored"), "severity.positive")
  }

  func testRiderSignalCuesPlayTheirSeverityAtAdvisoryPriority() {
    XCTAssertEqual(appCueSlot("groupRide.signal.serious"), "severity.critical")
    XCTAssertEqual(appCueSlot("groupRide.signal.minor"), "severity.warning")
    XCTAssertEqual(appCueSlot("groupRide.signal.down"), "severity.info")
    XCTAssertEqual(appCueSlot("groupRide.signal.wait"), "severity.info")
    XCTAssertEqual(appCueSlot("groupRide.hazard.mud"), "severity.warning")
    XCTAssertEqual(appCueSlot("groupRide.hazard.sent"), "severity.info")
    XCTAssertNil(appCueSlot("groupRide.hazard.lava"))
    XCTAssertEqual(appCuePriority("groupRide.hazard.water"), .advisory)
    XCTAssertEqual(appCueSlot("groupRide.signal.board"), "severity.warning")
    XCTAssertEqual(appCueSlot("groupRide.signal.ok"), "severity.positive")
    XCTAssertEqual(appCueVoiceKey("groupRide.signal.wait"), "groupRide.signal.wait")
    XCTAssertEqual(appCuePriority("groupRide.signal.battery"), .advisory)
    XCTAssertEqual(appCuePriority("groupRide.riderJoined"), .social)
  }

  func testEverySignalAndHazardKindHasACueWithItsSeverity() {
    for kind in RiderSignalKind.allCases {
      let cue = "groupRide.signal.\(kind.rawValue)"
      XCTAssertTrue(groupRideCues.contains(cue), cue)
      XCTAssertEqual(appCueSlot(cue), "severity.\(kind.severity.rawValue)", cue)
    }
    for kind in RideHazardKind.allCases {
      let cue = RideHazardCues.cuePrefix + kind.rawValue
      XCTAssertTrue(groupRideCues.contains(cue), cue)
      XCTAssertEqual(appCueSlot(cue), "severity.warning", cue)
    }
  }
}
