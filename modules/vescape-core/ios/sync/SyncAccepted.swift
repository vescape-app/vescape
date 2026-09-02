import Foundation

/// The `200` body: what the server took, per table.
///
/// Validated exactly before any cursor moves. A missing table, an extra table, a non-integer count
/// or a count that differs from what was submitted is a protocol failure — the server applies a
/// batch whole, so anything else means the two sides disagree about what was stored, and advancing a
/// cursor on that disagreement is unrecoverable.
///
/// Parsed here rather than with `JSONSerialization` so the rule behaves identically on both
/// platforms.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncAccepted.kt
enum SyncAccepted {
  /// Accepted counts by table, or nil when the body is not exactly the expected response.
  static func parse(_ body: String) -> [SyncTable: Int]? {
    var counts: [SyncTable: Int] = [:]
    var scanner = Scanner(body)
    guard scanner.expect("{"), scanner.expectKey("accepted"), scanner.expect("{") else { return nil }
    if scanner.peek() != "}" {
      while true {
        guard let name = scanner.string(), let table = SyncTable(rawValue: name) else { return nil }
        if counts[table] != nil || !scanner.expect(":") { return nil }
        guard let value = scanner.integer() else { return nil }
        counts[table] = value
        if scanner.expect(",") { continue }
        break
      }
    }
    guard scanner.expect("}"), scanner.expect("}"), scanner.atEnd() else { return nil }
    return counts.count == SyncTable.allCases.count ? counts : nil
  }

  /// True when the response accounts for exactly the rows submitted, table by table.
  static func matches(submitted: [SyncTable: Int], accepted: [SyncTable: Int]) -> Bool {
    SyncTable.allCases.allSatisfy { accepted[$0] == (submitted[$0] ?? 0) }
  }

  private struct Scanner {
    private let source: [Character]
    private var index = 0

    init(_ source: String) {
      self.source = Array(source)
    }

    mutating func atEnd() -> Bool {
      skipSpace()
      return index >= source.count
    }

    mutating func peek() -> Character? {
      skipSpace()
      return index < source.count ? source[index] : nil
    }

    mutating func expect(_ character: Character) -> Bool {
      guard peek() == character else { return false }
      index += 1
      return true
    }

    mutating func expectKey(_ name: String) -> Bool {
      string() == name && expect(":")
    }

    mutating func string() -> String? {
      guard expect("\"") else { return nil }
      var value = ""
      // Counts and table names carry no escapes; a body that needs them is not this response.
      while index < source.count, source[index] != "\"" {
        value.append(source[index])
        index += 1
      }
      guard index < source.count else { return nil }
      index += 1
      return value
    }

    mutating func integer() -> Int? {
      skipSpace()
      var digits = ""
      while index < source.count, source[index].isNumber {
        digits.append(source[index])
        index += 1
      }
      return digits.isEmpty ? nil : Int(digits)
    }

    private mutating func skipSpace() {
      while index < source.count, source[index].isWhitespace { index += 1 }
    }
  }
}
