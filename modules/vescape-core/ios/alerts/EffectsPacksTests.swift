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
}
