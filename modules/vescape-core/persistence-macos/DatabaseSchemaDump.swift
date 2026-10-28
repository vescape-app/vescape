import Foundation
import GRDB

private let internalTables: Set<String> = ["room_master_table", "android_metadata", "grdb_migrations"]

/// Tables, columns, indexes, and foreign keys in a form that does not depend on which platform built them.
/// @parity /modules/vescape-core/persistence-jvm/src/test/kotlin/expo/modules/vescapecore/telemetry/DatabaseSchemaHostTest.kt `dumpDatabaseSchema`
func dumpDatabaseSchema(_ db: Database) throws -> [String: Any] {
  func text(_ row: Row, _ column: String) -> String? { row[column] as String? }
  var tables: [String: Any] = [:]
  let tableNames = try String.fetchAll(db, sql: "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .filter { !internalTables.contains($0) }
  for table in tableNames {
    var columns: [String: Any] = [:]
    for column in try Row.fetchAll(db, sql: "PRAGMA table_info(`\(table)`)") {
      columns[column["name"] as String] = [
        "type": (column["type"] as String).uppercased(),
        "notNull": (column["notnull"] as Int) == 1,
        "default": text(column, "dflt_value") as Any? ?? NSNull(),
        "primaryKey": column["pk"] as Int,
      ] as [String: Any]
    }
    var indexes: [String: Any] = [:]
    for index in try Row.fetchAll(db, sql: "PRAGMA index_list(`\(table)`)") {
      let origin: String = index["origin"]
      if origin == "pk" { continue }
      let name: String = index["name"]
      let indexColumns = try Row.fetchAll(db, sql: "PRAGMA index_info(`\(name)`)")
        .sorted { ($0["seqno"] as Int) < ($1["seqno"] as Int) }
        .map { $0["name"] as String? }
      let sql = try String.fetchOne(db, sql: "SELECT sql FROM sqlite_master WHERE type='index' AND name=?", arguments: [name])
      // Constraint indexes get generated names, so key them by what they cover instead.
      let key = origin == "c" ? name : "unique(\(indexColumns.map { $0 ?? "null" }.joined(separator: ",")))"
      indexes[key] = [
        "columns": indexColumns.map { $0 as Any? ?? NSNull() },
        "unique": (index["unique"] as Int) == 1,
        "where": sql.flatMap(partialIndexPredicate) as Any? ?? NSNull(),
      ] as [String: Any]
    }
    let foreignKeys = try Row.fetchAll(db, sql: "PRAGMA foreign_key_list(`\(table)`)")
      .map { "\($0["from"] as String) -> \($0["table"] as String).\($0["to"] as String) on delete \($0["on_delete"] as String) on update \($0["on_update"] as String)" }
      .sorted()
    tables[table] = ["columns": columns, "indexes": indexes, "foreignKeys": foreignKeys]
  }
  return ["tables": tables]
}

private func partialIndexPredicate(_ sql: String) -> String? {
  guard let at = sql.range(of: #"\bWHERE\b"#, options: [.regularExpression, .caseInsensitive]) else { return nil }
  return sql[at.upperBound...]
    .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
    .replacingOccurrences(of: "`", with: "")
    .replacingOccurrences(of: "\"", with: "")
    .trimmingCharacters(in: .whitespaces)
}

/// Fails with a per-table summary when the database differs from the neutral schema file.
func requireSharedSchema(_ label: String, _ db: Database, root: URL) throws {
  let schemaURL = root.appendingPathComponent("schema/database.json")
  let expected = try JSONSerialization.jsonObject(with: Data(contentsOf: schemaURL)) as! [String: Any]
  let actual = try dumpDatabaseSchema(db)
  // Canonical JSON, not NSDictionary equality, which would treat `true` and `1` as the same value.
  if try canonicalJson(expected) == canonicalJson(actual) { return }
  let written = FileManager.default.temporaryDirectory.appendingPathComponent("database-schema.ios-\(label).json")
  try JSONSerialization.data(withJSONObject: actual, options: [.prettyPrinted, .sortedKeys]).write(to: written)
  let want = expected["tables"] as! [String: [String: Any]]
  let have = actual["tables"] as! [String: [String: Any]]
  var lines: [String] = []
  for table in Set(want.keys).union(have.keys).sorted() {
    guard let w = want[table] else { lines.append("  unexpected table \(table)"); continue }
    guard let h = have[table] else { lines.append("  missing table \(table)"); continue }
    for part in ["columns", "indexes"] {
      let wantPart = w[part] as! [String: Any], havePart = h[part] as! [String: Any]
      for name in Set(wantPart.keys).union(havePart.keys).sorted() {
        let expectedValue = wantPart[name] as? NSDictionary, actualValue = havePart[name] as? NSDictionary
        if let expectedValue, let actualValue, expectedValue.isEqual(actualValue) { continue }
        lines.append("  \(table).\(part).\(name): expected \(compact(expectedValue)), got \(compact(actualValue))")
      }
    }
    if !(w["foreignKeys"] as! NSArray).isEqual(h["foreignKeys"] as! NSArray) {
      lines.append("  \(table).foreignKeys: expected \(w["foreignKeys"]!), got \(h["foreignKeys"]!)")
    }
  }
  throw Failure(description: "iOS \(label) schema differs from schema/database.json:\n\(lines.joined(separator: "\n"))\nFull dump: \(written.path)")
}

private func compact(_ value: NSDictionary?) -> String {
  guard let value else { return "nothing" }
  let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
  return data.map { String(decoding: $0, as: UTF8.self) } ?? "\(value)"
}

private func canonicalJson(_ value: Any) throws -> Data {
  try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
}
