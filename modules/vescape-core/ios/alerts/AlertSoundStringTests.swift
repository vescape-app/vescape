import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/alerts/AlertSoundStringTest.kt
final class AlertSoundStringTests: XCTestCase {
  func testParsesTheGrammarTable() {
    let cases: [(String, AlertSoundString?)] = [
      ("tts(info):Battery low", AlertSoundString(kind: "tts", variant: "info", sound: "Battery low")),
      ("tts:Battery low", AlertSoundString(kind: "tts", variant: nil, sound: "Battery low")),
      ("tts():x", AlertSoundString(kind: "tts", variant: nil, sound: "x")),
      ("tts(critical):Time: 12:30", AlertSoundString(kind: "tts", variant: "critical", sound: "Time: 12:30")),
      ("tts:", AlertSoundString(kind: "tts", variant: nil, sound: "")),
      ("alert(3):my:beep", AlertSoundString(kind: "alert", variant: "3", sound: "my:beep")),
      ("preset:beep", AlertSoundString(kind: "preset", variant: nil, sound: "beep")),
      ("default", nil),
      ("Tts:x", nil),
      ("tts(warning:x", nil),
      ("", nil),
    ]
    for (raw, expected) in cases { XCTAssertEqual(AlertSoundString.parse(raw), expected, raw) }
  }

  func testReadsTtsSeverityDefaultingToWarning() {
    let cases: [(String, TtsAlertSound?)] = [
      ("tts(info):a", TtsAlertSound(severity: .info, text: "a")),
      ("tts(warning):a", TtsAlertSound(severity: .warning, text: "a")),
      ("tts(critical):a: b", TtsAlertSound(severity: .critical, text: "a: b")),
      ("tts:a", TtsAlertSound(severity: .warning, text: "a")),
      ("tts(loud):a", TtsAlertSound(severity: .warning, text: "a")),
      ("preset:beep", nil),
      ("default", nil),
    ]
    for (raw, expected) in cases { XCTAssertEqual(parseTtsAlertSound(raw), expected, raw) }
  }

  func testReadsVoiceKeyAndValue() {
    let cases: [(String, VoiceAlertSound?)] = [
      ("voice(critical):battery:10", VoiceAlertSound(severity: .critical, key: "battery", value: 10)),
      ("voice(info):motorTemp", VoiceAlertSound(severity: .info, key: "motorTemp", value: nil)),
      ("voice(warning):", VoiceAlertSound(severity: .warning, key: nil, value: nil)),
      ("voice:battery:-5.5", VoiceAlertSound(severity: .warning, key: "battery", value: -5.5)),
      ("voice(info):battery:x", VoiceAlertSound(severity: .info, key: "battery", value: nil)),
      ("tts(info):battery", nil),
    ]
    for (raw, expected) in cases { XCTAssertEqual(parseVoiceAlertSound(raw), expected, raw) }
  }

  func testReadsSlotAlertSoundsWithLegacyAndUnknownFallbacks() {
    let cases: [(String, SlotAlertSound)] = [
      ("alert(3):warning", SlotAlertSound(count: 3, severity: .warning)),
      ("alert(1):critical", SlotAlertSound(count: 1, severity: .critical)),
      ("alert:info", SlotAlertSound(count: 1, severity: .info)),
      ("alert(9):info", SlotAlertSound(count: 5, severity: .info)),
      ("alert(0):info", SlotAlertSound(count: 1, severity: .info)),
      ("alert(x):critical", SlotAlertSound(count: 1, severity: .critical)),
      ("alert(2):my:beep", SlotAlertSound(count: 2, severity: .warning)),
      ("alert(2):loud", SlotAlertSound(count: 2, severity: .warning)),
      ("preset:beep", SlotAlertSound(count: 1, severity: .warning)),
      ("preset:urgent", SlotAlertSound(count: 1, severity: .critical)),
      ("preset:notify", SlotAlertSound(count: 1, severity: .info)),
      ("default", SlotAlertSound(count: 1, severity: .warning)),
      ("nonsense", SlotAlertSound(count: 1, severity: .warning)),
    ]
    for (raw, expected) in cases { XCTAssertEqual(parseSlotAlertSound(raw), expected, raw) }
  }

  func testReadsGeigerLevelsWithLegacyAndUnknownFallbacks() {
    let cases: [(String, GeigerLevel?)] = [
      ("geiger:soft", .soft), ("geiger:mid", .mid), ("geiger:hard", .hard),
      ("geiger:loud", .soft), ("geiger:my:abc", .soft),
      ("preset:tick", .soft), ("preset:tick_hard", .mid), ("preset:gamma", .hard), ("preset:sustained", .hard),
      ("alert:warning", nil), ("preset:beep", nil), ("default", nil),
    ]
    for (raw, expected) in cases { XCTAssertEqual(parseGeigerAlertSound(raw), expected, raw) }
  }

  func testReadsMySoundIdsOnlyFromAlertAndGeigerSounds() {
    let cases: [(String, String?)] = [
      ("alert(3):my:beep", "beep"), ("alert:my:beep", "beep"), ("geiger:my:abc", "abc"),
      ("alert(2):my:", nil), ("alert:warning", nil), ("geiger:soft", nil),
      ("tts(warning):my:beep", nil), ("my:beep", nil),
    ]
    for (raw, expected) in cases { XCTAssertEqual(mySoundId(raw), expected, raw) }
  }
}
