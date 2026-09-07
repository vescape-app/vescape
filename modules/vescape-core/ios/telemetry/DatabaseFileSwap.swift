import Foundation

/// Installs a staged SQLite file and restores the complete former file set on any failure.
internal func replacingDatabaseFiles<T>(
  source: URL,
  target: URL,
  install: (URL) throws -> T
) throws -> T {
  let fm = FileManager.default
  let suffixes = ["", "-wal", "-shm"]
  let rollbackDir = target.deletingLastPathComponent()
    .appendingPathComponent("\(target.lastPathComponent).rollback-\(UUID().uuidString)", isDirectory: true)
  try fm.createDirectory(at: rollbackDir, withIntermediateDirectories: true)
  var moved: [(original: URL, saved: URL)] = []
  do {
    for suffix in suffixes {
      let current = URL(fileURLWithPath: target.path + suffix)
      guard fm.fileExists(atPath: current.path) else { continue }
      let saved = rollbackDir.appendingPathComponent(target.lastPathComponent + suffix)
      try fm.moveItem(at: current, to: saved)
      moved.append((current, saved))
    }
    try fm.copyItem(at: source, to: target)
    let result = try install(target)
    try fm.removeItem(at: rollbackDir)
    return result
  } catch {
    let installError = error
    var rollbackErrors: [Error] = []
    for suffix in suffixes {
      let installed = URL(fileURLWithPath: target.path + suffix)
      if fm.fileExists(atPath: installed.path) {
        do { try fm.removeItem(at: installed) } catch { rollbackErrors.append(error) }
      }
    }
    for entry in moved {
      do { try fm.moveItem(at: entry.saved, to: entry.original) } catch { rollbackErrors.append(error) }
    }
    guard !rollbackErrors.isEmpty else {
      try fm.removeItem(at: rollbackDir)
      throw installError
    }
    let rollbackDetails = rollbackErrors.map { String(describing: $0) }.joined(separator: "; ")
    throw NSError(
      domain: "VescapeDatabaseSwap",
      code: 2,
      userInfo: [
        NSLocalizedDescriptionKey: "Database install failed and rollback was incomplete; preserved recovery files at \(rollbackDir.path)",
        NSUnderlyingErrorKey: installError,
        "rollbackErrors": rollbackDetails,
      ]
    )
  }
}
