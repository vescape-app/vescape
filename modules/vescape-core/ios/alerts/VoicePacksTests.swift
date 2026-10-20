import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/alerts/VoicePacksTest.kt
final class VoicePacksTests: XCTestCase {
  private let manifest = VoicePackManifest.parse(Data("""
    {
      "lines": {
        "battery": { "start": ["b.0"], "end": [] },
        "battery.critical": { "start": ["bc.0", "bc.1"], "end": ["plug"] },
        "motorTemp": { "start": ["m.0"], "end": [] },
        "motorTemp.warning": { "start": ["mw.0"], "end": ["soon", ""] }
      },
      "values": {
        "percent": { "20": "p20" },
        "degrees": { "-5": "dm5", "95": "d95", "203": "d203" }
      }
    }
    """.utf8))!

  func testMatchingFollowsTheEffectsPackVoice() {
    XCTAssertEqual(voicePackId("matching", effectsVoice: "hev"), "hev")
    XCTAssertEqual(voicePackId("matching", effectsVoice: nil), "clean")
    XCTAssertEqual(voicePackId("matching", effectsVoice: "santa"), "clean")
    XCTAssertEqual(voicePackId("hev", effectsVoice: "clean"), "hev")
    XCTAssertEqual(voicePackId("nicole", effectsVoice: nil), "clean")
  }

  func testAnnouncementTakesKeyFromMetricAndValueFromThreshold() {
    let custom = VoiceAlertSound(severity: .info, key: nil, value: nil)
    XCTAssertEqual(
      voiceAnnouncement(custom, controlId: "battery", threshold: 19.6, percentAvailable: true, unitSystem: "metric"),
      VoiceAnnouncement(severity: .info, key: "battery", value: 20)
    )
    // Without a battery config the threshold is volts, not a percent.
    XCTAssertEqual(
      voiceAnnouncement(custom, controlId: "battery", threshold: 42, percentAvailable: false, unitSystem: "metric"),
      VoiceAnnouncement(severity: .info, key: "battery", value: nil)
    )
    XCTAssertEqual(
      voiceAnnouncement(custom, controlId: "speed", threshold: 30, percentAvailable: true, unitSystem: "metric"),
      VoiceAnnouncement(severity: .info, key: nil, value: nil)
    )
    let preset = VoiceAlertSound(severity: .critical, key: "motorTemp", value: nil)
    XCTAssertEqual(
      voiceAnnouncement(preset, controlId: "motor-temp", threshold: 95, percentAvailable: false, unitSystem: "metric"),
      VoiceAnnouncement(severity: .critical, key: "motorTemp", value: 95)
    )
    // °F converts before rounding: 95 °C = 203 °F, −20.6 °C = −5.08 °F.
    XCTAssertEqual(voiceAnnouncement(preset, controlId: "motor-temp", threshold: 95, percentAvailable: false, unitSystem: "imperial").value, 203)
    XCTAssertEqual(voiceAnnouncement(preset, controlId: "motor-temp", threshold: -20.6, percentAvailable: false, unitSystem: "imperial").value, -5)
    let explicit = VoiceAlertSound(severity: .warning, key: "battery", value: 10)
    XCTAssertEqual(voiceAnnouncement(explicit, controlId: "speed", threshold: 50, percentAvailable: false, unitSystem: "metric").value, 10)
  }

  func testResolvesSeverityVariantThenGenericThenNothing() {
    let picker = VoiceVariantPicker { _ in 0 }
    XCTAssertEqual(picker.clips(manifest, VoiceAnnouncement(severity: .critical, key: "battery", value: 20)), ["bc.0", "p20", "plug"])
    XCTAssertEqual(picker.clips(manifest, VoiceAnnouncement(severity: .warning, key: "battery", value: 20)), ["b.0", "p20"])
    // A missing value clip is skipped, the line still plays.
    XCTAssertEqual(picker.clips(manifest, VoiceAnnouncement(severity: .info, key: "battery", value: 77)), ["b.0"])
    XCTAssertEqual(picker.clips(manifest, VoiceAnnouncement(severity: .info, key: "motorTemp", value: -5)), ["m.0", "dm5"])
    XCTAssertNil(picker.clips(manifest, VoiceAnnouncement(severity: .info, key: "controllerTemp", value: 80)))
    XCTAssertNil(picker.clips(manifest, VoiceAnnouncement(severity: .info, key: nil, value: nil)))
  }

  func testNeverRepeatsTheSameStartTwiceInARow() {
    let picker = VoiceVariantPicker { _ in 0 }
    let critical = VoiceAnnouncement(severity: .critical, key: "battery", value: nil)
    XCTAssertEqual(picker.clips(manifest, critical)?.first, "bc.0")
    XCTAssertEqual(picker.clips(manifest, critical)?.first, "bc.1")
    XCTAssertEqual(picker.clips(manifest, critical)?.first, "bc.0")
  }

  func testNextIsThePickTheFollowingAnnouncementPlays() {
    var picks = [1, 0, 0, 0, 0, 0]
    let picker = VoiceVariantPicker { _ in picks.removeFirst() }
    let critical = VoiceAnnouncement(severity: .critical, key: "battery", value: 20)
    XCTAssertNil(picker.next(manifest, critical))
    XCTAssertEqual(picker.clips(manifest, critical), ["bc.1", "p20", "plug"])
    let ahead = picker.next(manifest, critical)
    XCTAssertEqual(ahead, ["bc.0", "p20", "plug"])
    XCTAssertEqual(picker.clips(manifest, critical), ahead)
  }

  func testAnEmptyEndIsTheNoneVariant() {
    var picks = [0, 1, 0, 0, 0, 0]
    let picker = VoiceVariantPicker { _ in picks.removeFirst() }
    let warning = VoiceAnnouncement(severity: .warning, key: "motorTemp", value: nil)
    XCTAssertEqual(picker.clips(manifest, warning), ["mw.0"])
    XCTAssertEqual(picker.clips(manifest, warning), ["mw.0", "soon"])
  }

  func testTrimsOnlyLeadingPadding() {
    let quiet: Float = 10 / 32767
    let loud: Float = 500 / 32767
    [0, quiet, -quiet, loud, 0].withUnsafeBufferPointer { XCTAssertEqual(leadingSilenceFrames($0, maxFrames: 100), 3) }
    [Float](repeating: 0, count: 10).withUnsafeBufferPointer { XCTAssertEqual(leadingSilenceFrames($0, maxFrames: 4), 4) }
  }

  /// The committed packs carry what the presets speak: every severity of each key resolves, and the
  /// values the presets announce exist.
  func testCommittedPacksSpeakEveryPresetKey() throws {
    let root = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .appendingPathComponent("../../../../shared/alerts/packs")
      .standardizedFileURL
    for pack in voicePackIds {
      let manifest = try XCTUnwrap(voicePackManifest(root: root, pack: pack), pack)
      for key in ["battery", "motorTemp", "controllerTemp"] {
        for severity in AlertSeverity.allCases { XCTAssertNotNil(manifest.line(key: key, severity: severity), "\(pack) \(key)") }
      }
      XCTAssertNotNil(manifest.valueClip(key: "battery", value: 5), pack)
      XCTAssertNotNil(manifest.valueClip(key: "motorTemp", value: -30), pack)
      XCTAssertNotNil(manifest.valueClip(key: "motorTemp", value: 203), pack)
    }
    XCTAssertEqual(effectsPackVoices(root: root)["retro"], "clean")
    XCTAssertEqual(effectsPackVoices(root: root)["hev"], "hev")
  }
}
