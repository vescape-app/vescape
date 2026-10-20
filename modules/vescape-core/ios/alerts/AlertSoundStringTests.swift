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
}
