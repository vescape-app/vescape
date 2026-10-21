import CryptoKit
import Foundation
import GRDB

/// One immutable Favorite Media manifest row. SQLite owns metadata; the canonical file path is
/// derived only from the Favorite and media ids plus the stored MIME type.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt `FavoriteMediaEntity`
/// @parity /modules/vescape-core/src/index.ts `FavoriteMedia`
struct FavoriteMedia {
  let id: String
  let favoriteId: String
  let capturedAtMs: Int64?
  let mimeType: String
  let mediaKind: String
  let byteCount: Int64
  let contentHash: String
  let createdAtMs: Int64

  func toMap(fileURL: URL) -> [String: Any?] {
    [
      "id": id,
      "favoriteId": favoriteId,
      "capturedAtMs": capturedAtMs,
      "mimeType": mimeType,
      "mediaKind": mediaKind,
      "byteCount": byteCount,
      "contentHash": contentHash,
      "createdAtMs": createdAtMs,
      "uri": fileURL.absoluteString,
      "filename": fileURL.lastPathComponent,
    ]
  }
}

private struct FavoriteMediaRecord: Codable, PersistableRecord {
  static let databaseTableName = "favorite_media"
  let id: String
  let favoriteId: String
  let capturedAt: Int64?
  let mimeType: String
  let mediaKind: String
  let byteCount: Int64
  let contentHash: String
  let createdAt: Int64

  init(_ media: FavoriteMedia) {
    id = media.id; favoriteId = media.favoriteId; capturedAt = media.capturedAtMs
    mimeType = media.mimeType; mediaKind = media.mediaKind; byteCount = media.byteCount
    contentHash = media.contentHash; createdAt = media.createdAtMs
  }

  enum CodingKeys: String, CodingKey {
    case id
    case favoriteId = "favorite_id", capturedAt = "captured_at", mimeType = "mime_type"
    case mediaKind = "media_kind", byteCount = "byte_count", contentHash = "content_hash"
    case createdAt = "created_at"
  }
}

enum FavoriteMediaStoreError: Error {
  case favoriteNotFound
  case invalidSource
  case copyFailed
  case manifestWriteFailed
  case cleanupFailed
}

/// Native Favorite Media import and reconciliation (ADR 0030).
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/FavoriteMediaStore.kt
struct FavoriteMediaStore {
  private let resolveWriter: () -> DatabaseWriter?
  private let rootURL: URL

  static let shared = FavoriteMediaStore(
    resolveWriter: { TelemetryDatabase.pool },
    rootURL: defaultRootURL
  )

  init(resolveWriter: @escaping () -> DatabaseWriter?, rootURL: URL) {
    self.resolveWriter = resolveWriter
    self.rootURL = rootURL
  }

  init(dbWriter: DatabaseWriter, rootURL: URL) {
    self.resolveWriter = { dbWriter }
    self.rootURL = rootURL
  }

  static var defaultRootURL: URL {
    do {
      return try FileManager.default.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
      ).appendingPathComponent("favoriteMedia", isDirectory: true)
    } catch {
      #if canImport(Sentry)
      UnexpectedNativeError.report(
        operation: "favorite_media_root_resolve",
        category: "filesystem",
        error: error
      )
      #endif
      // This is the documented user-domain location. Avoid temporary storage, which the OS may
      // evict while the manifest still says the favorite owns media.
      return URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
        .appendingPathComponent("Library/Application Support/favoriteMedia", isDirectory: true)
    }
  }

  static func createTables(_ db: Database) throws {
    try PersistenceSchema.createFavoriteMedia(db)
  }

  func list(favoriteId: String) throws -> [FavoriteMedia] {
    try reconcile(favoriteId: favoriteId)
    guard let writer = resolveWriter() else { throw FavoriteMediaStoreError.manifestWriteFailed }
    return try writer.read { db in
      try Row.fetchAll(
        db,
        sql: "SELECT * FROM favorite_media WHERE favorite_id = ? ORDER BY created_at, id",
        arguments: [favoriteId]
      ).map(Self.media)
    }
  }

  func importMedia(
    favoriteId: String,
    sourceURI: String,
    capturedAtMs: Int64?,
    mimeType: String,
    mediaKind: String
  ) throws -> FavoriteMedia {
    guard let writer = resolveWriter() else { throw FavoriteMediaStoreError.manifestWriteFailed }
    let favoriteExists = try writer.read { db in
      try Bool.fetchOne(
        db,
        sql: "SELECT EXISTS(SELECT 1 FROM favorites WHERE id = ?)",
        arguments: [favoriteId]
      ) ?? false
    }
    guard favoriteExists else { throw FavoriteMediaStoreError.favoriteNotFound }
    guard let source = URL(string: sourceURI), source.isFileURL else {
      throw FavoriteMediaStoreError.invalidSource
    }
    guard ["photo", "video"].contains(mediaKind), !mimeType.isEmpty else {
      throw FavoriteMediaStoreError.invalidSource
    }

    let id = UUID().uuidString.lowercased()
    let createdAtMs = Int64(Date().timeIntervalSince1970 * 1_000)
    let media = FavoriteMedia(
      id: id,
      favoriteId: favoriteId,
      capturedAtMs: capturedAtMs,
      mimeType: mimeType,
      mediaKind: mediaKind,
      byteCount: 0,
      contentHash: "",
      createdAtMs: createdAtMs
    )
    let directory = favoriteDirectory(favoriteId)
    let temporary = directory.appendingPathComponent(".\(id).import")
    let destination = fileURL(for: media)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

    let copied: (count: Int64, hash: String)
    do {
      copied = try copyAndHash(from: source, to: temporary)
      try FileManager.default.moveItem(at: temporary, to: destination)
    } catch {
      // intentional-suppression: media cleanup and reconciliation are retryable best effort operations
      try? FileManager.default.removeItem(at: temporary)
      throw FavoriteMediaStoreError.copyFailed
    }

    let completed = FavoriteMedia(
      id: media.id,
      favoriteId: media.favoriteId,
      capturedAtMs: media.capturedAtMs,
      mimeType: media.mimeType,
      mediaKind: media.mediaKind,
      byteCount: copied.count,
      contentHash: copied.hash,
      createdAtMs: media.createdAtMs
    )
    do {
      try writer.write { db in
        try FavoriteMediaRecord(completed).insert(db)
      }
    } catch {
      // intentional-suppression: media cleanup and reconciliation are retryable best effort operations
      try? FileManager.default.removeItem(at: destination)
      throw FavoriteMediaStoreError.manifestWriteFailed
    }
    return completed
  }

  func fileURL(for media: FavoriteMedia) -> URL {
    favoriteDirectory(media.favoriteId)
      .appendingPathComponent(media.id)
      .appendingPathExtension(Self.extensionForMimeType(media.mimeType))
  }

  func deleteDirectory(favoriteId: String) throws {
    let directory = favoriteDirectory(favoriteId)
    guard FileManager.default.fileExists(atPath: directory.path) else { return }
    do { try FileManager.default.removeItem(at: directory) }
    catch { throw FavoriteMediaStoreError.cleanupFailed }
  }

  /// Repair cross-store disagreement on the normal Favorites read path: remove manifest rows whose
  /// parent disappeared, reconcile every live Favorite, and delete directories with no parent.
  func reconcileAll() throws {
    guard let writer = resolveWriter() else { throw FavoriteMediaStoreError.manifestWriteFailed }
    let favoriteIds = try writer.write { db -> [String] in
      try db.execute(
        sql: "DELETE FROM favorite_media WHERE favorite_id NOT IN (SELECT id FROM favorites)"
      )
      return try String.fetchAll(db, sql: "SELECT id FROM favorites")
    }
    let live = Set(favoriteIds)
    for favoriteId in favoriteIds { try reconcile(favoriteId: favoriteId) }
    // intentional-suppression: media cleanup and reconciliation are retryable best effort operations
    guard let directories = try? FileManager.default.contentsOfDirectory(
      at: rootURL,
      includingPropertiesForKeys: [.isDirectoryKey]
    ) else { return }
    for directory in directories where !live.contains(directory.lastPathComponent) {
      // intentional-suppression: media cleanup and reconciliation are retryable best effort operations
      try? FileManager.default.removeItem(at: directory)
    }
  }

  func reconcile(favoriteId: String) throws {
    guard let writer = resolveWriter() else { throw FavoriteMediaStoreError.manifestWriteFailed }
    let directory = favoriteDirectory(favoriteId)
    let rows = try writer.read { db in
      try Row.fetchAll(
        db,
        sql: "SELECT * FROM favorite_media WHERE favorite_id = ?",
        arguments: [favoriteId]
      ).map(Self.media)
    }
    let fm = FileManager.default
    var expected = Set<String>()
    var missing: [String] = []
    for row in rows {
      let file = fileURL(for: row)
      expected.insert(file.lastPathComponent)
      if !fm.fileExists(atPath: file.path) { missing.append(row.id) }
    }
    if !missing.isEmpty {
      try writer.write { db in
        for id in missing {
          try db.execute(sql: "DELETE FROM favorite_media WHERE id = ?", arguments: [id])
        }
      }
    }
    // intentional-suppression: media cleanup and reconciliation are retryable best effort operations
    guard let entries = try? fm.contentsOfDirectory(
      at: directory,
      includingPropertiesForKeys: nil
    ) else { return }
    for entry in entries where entry.lastPathComponent.hasPrefix(".") || !expected.contains(entry.lastPathComponent) {
      // intentional-suppression: media cleanup and reconciliation are retryable best effort operations
      try? fm.removeItem(at: entry)
    }
  }

  private func favoriteDirectory(_ favoriteId: String) -> URL {
    rootURL.appendingPathComponent(favoriteId, isDirectory: true)
  }

  private static func media(_ row: Row) -> FavoriteMedia {
    FavoriteMedia(
      id: row["id"],
      favoriteId: row["favorite_id"],
      capturedAtMs: row["captured_at"],
      mimeType: row["mime_type"],
      mediaKind: row["media_kind"],
      byteCount: row["byte_count"],
      contentHash: row["content_hash"],
      createdAtMs: row["created_at"]
    )
  }

  private static func extensionForMimeType(_ mimeType: String) -> String {
    switch mimeType.lowercased() {
    case "image/png": return "png"
    case "image/heic", "image/heif": return "heic"
    case "image/webp": return "webp"
    case "video/quicktime": return "mov"
    case "video/webm": return "webm"
    case "video/x-m4v": return "m4v"
    case "video/mp4": return "mp4"
    default: return mimeType.hasPrefix("video/") ? "mp4" : "jpg"
    }
  }

  private func copyAndHash(from source: URL, to destination: URL) throws -> (Int64, String) {
    guard let input = InputStream(url: source), let output = OutputStream(url: destination, append: false)
    else { throw FavoriteMediaStoreError.invalidSource }
    input.open()
    output.open()
    defer {
      input.close()
      output.close()
    }
    var digest = SHA256()
    var count: Int64 = 0
    var buffer = [UInt8](repeating: 0, count: 64 * 1_024)
    while true {
      let read = input.read(&buffer, maxLength: buffer.count)
      if read < 0 { throw input.streamError ?? FavoriteMediaStoreError.copyFailed }
      if read == 0 { break }
      var offset = 0
      while offset < read {
        let written = buffer.withUnsafeBytes { rawBuffer in
          output.write(
            rawBuffer.bindMemory(to: UInt8.self).baseAddress!.advanced(by: offset),
            maxLength: read - offset
          )
        }
        if written <= 0 { throw output.streamError ?? FavoriteMediaStoreError.copyFailed }
        offset += written
      }
      digest.update(data: Data(buffer[0..<read]))
      count += Int64(read)
    }
    return (count, digest.finalize().map { String(format: "%02x", $0) }.joined())
  }
}
