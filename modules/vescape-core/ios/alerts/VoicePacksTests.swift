import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/alerts/VoicePacksTest.kt
final class VoicePacksTests: XCTestCase {
  private let manifest = VoicePackManifest.parse(Data("""
    {
      "lines": {
        "battery": { "start": ["b.0"], "minimal": ["bm.0"] },
        "battery.critical": {
          "start": ["bc.0"],
          "full": { "start": ["bcf.0", "bcf.1"], "end": ["plug"], "endChance": 0.2 }
        },
        "motorTemp": { "start": ["m.0"] }
      },
      "values": {
        "percent": { "20": "p20" },
        "degrees": { "-5": "dm5", "95": "d95", "203": "d203" }
      }
    }
    """.utf8))!

  private func battery(_ severity: AlertSeverity, _ wording: VoiceWording, _ value: Int? = 20) -> VoiceAnnouncement {
    VoiceAnnouncement(severity: severity, key: "battery", value: value, wording: wording)
  }

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
      voiceAnnouncement(custom, controlId: "battery", reading: 19.6, percentAvailable: true, unitSystem: "metric"),
      VoiceAnnouncement(severity: .info, key: "battery", value: 20)
    )
    // Without a battery config the threshold is volts, not a percent.
    XCTAssertEqual(
      voiceAnnouncement(custom, controlId: "battery", reading: 42, percentAvailable: false, unitSystem: "metric"),
      VoiceAnnouncement(severity: .info, key: "battery", value: nil)
    )
    XCTAssertEqual(
      voiceAnnouncement(custom, controlId: "power", reading: 30, percentAvailable: true, unitSystem: "metric"),
      VoiceAnnouncement(severity: .info, key: nil, value: nil)
    )
    let preset = VoiceAlertSound(severity: .critical, key: "motorTemp", value: nil)
    XCTAssertEqual(
      voiceAnnouncement(preset, controlId: "motor-temp", reading: 95, percentAvailable: false, unitSystem: "metric"),
      VoiceAnnouncement(severity: .critical, key: "motorTemp", value: 95)
    )
    // °F converts before rounding: 95 °C = 203 °F, −20.6 °C = −5.08 °F.
    XCTAssertEqual(voiceAnnouncement(preset, controlId: "motor-temp", reading: 95, percentAvailable: false, unitSystem: "imperial").value, 203)
    XCTAssertEqual(voiceAnnouncement(preset, controlId: "motor-temp", reading: -20.6, percentAvailable: false, unitSystem: "imperial").value, -5)
    let explicit = VoiceAlertSound(severity: .warning, key: "battery", value: 10)
    XCTAssertEqual(voiceAnnouncement(explicit, controlId: "speed", reading: 50, percentAvailable: false, unitSystem: "metric").value, 10)
    // Speed reads in mph under imperial (50 km/h = 31.07 mph); duty stays a percent.
    let speed = VoiceAlertSound(severity: .warning, key: nil, value: nil)
    XCTAssertEqual(
      voiceAnnouncement(speed, controlId: "speed", reading: 50, percentAvailable: false, unitSystem: "metric"),
      VoiceAnnouncement(severity: .warning, key: "speed", value: 50)
    )
    XCTAssertEqual(voiceAnnouncement(speed, controlId: "speed", reading: 50, percentAvailable: false, unitSystem: "imperial").value, 31)
    XCTAssertEqual(
      voiceAnnouncement(speed, controlId: "duty", reading: 85, percentAvailable: false, unitSystem: "imperial"),
      VoiceAnnouncement(severity: .warning, key: "duty", value: 85)
    )
  }

  func testEachWordingPicksItsPhrasesThenFallsBack() {
    let picker = VoiceVariantPicker { _ in 0 }
    // Standard: the severity line's start, never an ending.
    XCTAssertEqual(picker.clips(manifest, battery(.critical, .standard)), ["bc.0", "p20"])
    XCTAssertEqual(picker.clips(manifest, battery(.warning, .standard)), ["b.0", "p20"])
    // Minimal: the generic line's minimal phrase, whatever the severity; start when it has none.
    XCTAssertEqual(picker.clips(manifest, battery(.critical, .minimal)), ["bm.0", "p20"])
    XCTAssertEqual(
      picker.clips(manifest, VoiceAnnouncement(severity: .critical, key: "motorTemp", value: -5, wording: .minimal)),
      ["m.0", "dm5"]
    )
    // Full: the full pool with its ending; start when the line has no pool.
    XCTAssertEqual(picker.clips(manifest, battery(.critical, .full)), ["bcf.0", "p20", "plug"])
    XCTAssertEqual(picker.clips(manifest, battery(.warning, .full)), ["b.0", "p20"])
    // A missing value clip is skipped, the line still plays.
    XCTAssertEqual(picker.clips(manifest, battery(.info, .standard, 77)), ["b.0"])
    XCTAssertNil(picker.clips(manifest, VoiceAnnouncement(severity: .info, key: "controllerTemp", value: 80)))
    XCTAssertNil(picker.clips(manifest, VoiceAnnouncement(severity: .info, key: nil, value: nil)))
  }

  func testAnEndingPlaysOnlyAtItsChance() {
    // Per pick: start variant, then a 0–99 roll that ends the line below 20, then the ending.
    var picks = [0, 19, 0, 0, 20, 0, 99]
    let picker = VoiceVariantPicker { _ in picks.removeFirst() }
    let critical = battery(.critical, .full)
    XCTAssertEqual(picker.clips(manifest, critical), ["bcf.0", "p20", "plug"])
    XCTAssertEqual(picker.clips(manifest, critical), ["bcf.1", "p20"])
  }

  func testNeverRepeatsTheSameStartTwiceInARow() {
    let picker = VoiceVariantPicker { _ in 0 }
    let critical = battery(.critical, .full, nil)
    XCTAssertEqual(picker.clips(manifest, critical)?.first, "bcf.0")
    XCTAssertEqual(picker.clips(manifest, critical)?.first, "bcf.1")
    XCTAssertEqual(picker.clips(manifest, critical)?.first, "bcf.0")
  }

  func testNextIsThePickTheFollowingAnnouncementPlays() {
    let picker = VoiceVariantPicker { _ in 0 }
    let critical = battery(.critical, .full)
    XCTAssertNil(picker.next(manifest, critical))
    XCTAssertEqual(picker.clips(manifest, critical), ["bcf.0", "p20", "plug"])
    let ahead = picker.next(manifest, critical)
    XCTAssertEqual(ahead, ["bcf.1", "p20", "plug"])
    XCTAssertEqual(picker.clips(manifest, critical), ahead)
    // Wordings keep separate picks.
    XCTAssertNil(picker.next(manifest, battery(.critical, .standard)))
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
        for severity in AlertSeverity.allCases {
          for wording in [VoiceWording.minimal, .standard, .full] {
            XCTAssertNotNil(manifest.phrases(key: key, severity: severity, wording: wording), "\(pack) \(key)")
          }
        }
      }
      XCTAssertNotNil(manifest.valueClip(key: "battery", value: 5), pack)
      XCTAssertNotNil(manifest.valueClip(key: "motorTemp", value: -30), pack)
      XCTAssertNotNil(manifest.valueClip(key: "motorTemp", value: 203), pack)
    }
    XCTAssertEqual(effectsPackVoices(root: root)["retro"], "clean")
    XCTAssertEqual(effectsPackVoices(root: root)["hev"], "hev")
  }
}
