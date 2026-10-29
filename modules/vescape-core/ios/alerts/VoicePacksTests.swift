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
        "percent": { "20": "p20", "30": "p30" },
        "duration": { "150": "in150" },
        "degrees": { "-5": "dm5", "95": "d95", "203": "d203" }
      }
    }
    """.utf8))!

  private func battery(_ severity: AlertSeverity, _ wording: VoiceWording, _ value: Int? = 20) -> VoiceAnnouncement {
    VoiceAnnouncement(severity: severity, key: "battery", values: value.map { [VoiceValue(type: "percent", value: $0)] } ?? [], wording: wording)
  }

  func testMatchingFollowsTheEffectsPackVoice() {
    XCTAssertEqual(voicePackId("matching", effectsVoice: "radio"), "radio")
    XCTAssertEqual(voicePackId("matching", effectsVoice: nil), "nova")
    XCTAssertEqual(voicePackId("matching", effectsVoice: "santa"), "nova")
    XCTAssertEqual(voicePackId("radio", effectsVoice: "nova"), "radio")
    XCTAssertEqual(voicePackId("nicole", effectsVoice: nil), "nicole")
    XCTAssertEqual(voicePackId("santa", effectsVoice: nil), "nova")
  }

  func testAnnouncementTakesKeyFromMetricAndValueFromThreshold() {
    let custom = VoiceAlertSound(severity: .info, key: nil, value: nil)
    XCTAssertEqual(
      voiceAnnouncement(custom, controlId: "battery", reading: 19.6, percentAvailable: true, distanceUnit: "km", temperatureUnit: "celsius"),
      VoiceAnnouncement(severity: .info, key: "battery", values: [VoiceValue(type: "percent", value: 20)])
    )
    // Without a battery config the threshold is volts, not a percent.
    XCTAssertEqual(
      voiceAnnouncement(custom, controlId: "battery", reading: 42, percentAvailable: false, distanceUnit: "km", temperatureUnit: "celsius"),
      VoiceAnnouncement(severity: .info, key: "battery")
    )
    XCTAssertEqual(
      voiceAnnouncement(custom, controlId: "power", reading: 30, percentAvailable: true, distanceUnit: "km", temperatureUnit: "celsius"),
      VoiceAnnouncement(severity: .info, key: nil)
    )
    let preset = VoiceAlertSound(severity: .critical, key: "motorTemp", value: nil)
    XCTAssertEqual(
      voiceAnnouncement(preset, controlId: "motor-temp", reading: 95, percentAvailable: false, distanceUnit: "km", temperatureUnit: "celsius"),
      VoiceAnnouncement(severity: .critical, key: "motorTemp", values: [VoiceValue(type: "degrees", value: 95)])
    )
    // °F converts before rounding: 95 °C = 203 °F, −20.6 °C = −5.08 °F.
    XCTAssertEqual(voiceAnnouncement(preset, controlId: "motor-temp", reading: 95, percentAvailable: false, distanceUnit: "km", temperatureUnit: "fahrenheit").values.first?.value, 203)
    XCTAssertEqual(voiceAnnouncement(preset, controlId: "motor-temp", reading: -20.6, percentAvailable: false, distanceUnit: "km", temperatureUnit: "fahrenheit").values.first?.value, -5)
    // Degrees follow the temperature unit, not the distance unit.
    XCTAssertEqual(voiceAnnouncement(preset, controlId: "motor-temp", reading: 95, percentAvailable: false, distanceUnit: "mi", temperatureUnit: "celsius").values.first?.value, 95)
    let explicit = VoiceAlertSound(severity: .warning, key: "battery", value: 10)
    XCTAssertEqual(voiceAnnouncement(explicit, controlId: "speed", reading: 50, percentAvailable: false, distanceUnit: "km", temperatureUnit: "celsius").values.first?.value, 10)
    // Speed reads in mph under mi (50 km/h = 31.07 mph); duty stays a percent.
    let speed = VoiceAlertSound(severity: .warning, key: nil, value: nil)
    XCTAssertEqual(
      voiceAnnouncement(speed, controlId: "speed", reading: 50, percentAvailable: false, distanceUnit: "km", temperatureUnit: "celsius"),
      VoiceAnnouncement(severity: .warning, key: "speed", values: [VoiceValue(type: "number", value: 50)])
    )
    XCTAssertEqual(voiceAnnouncement(speed, controlId: "speed", reading: 50, percentAvailable: false, distanceUnit: "mi", temperatureUnit: "celsius").values.first?.value, 31)
    XCTAssertEqual(
      voiceAnnouncement(speed, controlId: "duty", reading: 85, percentAvailable: false, distanceUnit: "mi", temperatureUnit: "celsius"),
      VoiceAnnouncement(severity: .warning, key: "dutyCycle", values: [VoiceValue(type: "number", value: 85)])
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
      picker.clips(manifest, VoiceAnnouncement(severity: .critical, key: "motorTemp", values: [VoiceValue(type: "degrees", value: -5)], wording: .minimal)),
      ["m.0", "dm5"]
    )
    // Full: the full pool with its ending; start when the line has no pool.
    XCTAssertEqual(picker.clips(manifest, battery(.critical, .full)), ["bcf.0", "p20", "plug"])
    XCTAssertEqual(picker.clips(manifest, battery(.warning, .full)), ["b.0", "p20"])
    // A missing value clip is skipped, the line still plays.
    XCTAssertEqual(picker.clips(manifest, battery(.info, .standard, 77)), ["b.0"])
    XCTAssertNil(picker.clips(manifest, VoiceAnnouncement(severity: .info, key: "controllerTemp", values: [VoiceValue(type: "degrees", value: 80)])))
    XCTAssertNil(picker.clips(manifest, VoiceAnnouncement(severity: .info, key: nil)))
  }

  func testMultipleValuesPlayInOrderSkippingMissingClips() {
    let picker = VoiceVariantPicker { _ in 0 }
    let rain = { (values: [VoiceValue]) in VoiceAnnouncement(severity: .critical, key: "battery", values: values, wording: .full) }
    XCTAssertEqual(
      picker.clips(manifest, rain([VoiceValue(type: "duration", value: 150), VoiceValue(type: "percent", value: 30)])),
      ["bcf.0", "in150", "p30", "plug"]
    )
    // The type travels with each value: 30 as a duration has no clip, the percent still plays.
    XCTAssertEqual(
      picker.clips(manifest, rain([VoiceValue(type: "duration", value: 30), VoiceValue(type: "percent", value: 30)])),
      ["bcf.1", "p30", "plug"]
    )
    XCTAssertEqual(picker.clips(manifest, rain([VoiceValue(type: "wind", value: 150)])), ["bcf.0", "plug"])
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
      XCTAssertNotNil(manifest.valueClip(VoiceValue(type: "percent", value: 5)), pack)
      XCTAssertNotNil(manifest.valueClip(VoiceValue(type: "degrees", value: -30)), pack)
      XCTAssertNotNil(manifest.valueClip(VoiceValue(type: "degrees", value: 203)), pack)
      for minutes in [15, 30, 45, 60, 90, 120, 150, 180] {
        XCTAssertNotNil(manifest.valueClip(VoiceValue(type: "duration", value: minutes)), "\(pack) duration \(minutes)")
      }
    }
    XCTAssertEqual(effectsPackVoices(root: root)["arc"], "nova")
    XCTAssertEqual(effectsPackVoices(root: root)["hev"], "radio")
  }
}
