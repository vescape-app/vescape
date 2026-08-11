import CryptoKit
import GRDB
import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/telemetry/FavoriteMediaTest.kt
final class FavoriteMediaStoreTests: XCTestCase {
  private var queue: DatabaseQueue!
  private var root: URL!
  private var store: FavoriteMediaStore!

  override func setUpWithError() throws {
    queue = try DatabaseQueue()
    try queue.write { db in
      try FavoriteStore.createTables(db)
      try FavoriteMediaStore.createTables(db)
    }
    root = FileManager.default.temporaryDirectory
      .appendingPathComponent("favorite-media-tests-\(UUID().uuidString)", isDirectory: true)
    store = FavoriteMediaStore(dbWriter: queue, rootURL: root)
    XCTAssertTrue(FavoriteStore(dbWriter: queue).insert(favorite()))
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: root)
    store = nil
    queue = nil
  }

  func testImportCopiesBytesThenPublishesHashAndManifest() throws {
    let source = root.appendingPathComponent("picked.jpg")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let bytes = Data("favorite bytes".utf8)
    try bytes.write(to: source)

    let media = try store.importMedia(
      favoriteId: "favorite-1",
      sourceURI: source.absoluteString,
      capturedAtMs: 1_234,
      mimeType: "image/jpeg",
      mediaKind: "photo"
    )

    XCTAssertEqual(media.byteCount, Int64(bytes.count))
    XCTAssertEqual(
      media.contentHash,
      SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    )
    XCTAssertTrue(FileManager.default.fileExists(atPath: store.fileURL(for: media).path))
    XCTAssertEqual(store.list(favoriteId: "favorite-1").map(\.id), [media.id])
  }

  func testReadReconciliationRemovesMissingRowsAndOrphanFiles() throws {
    let directory = root.appendingPathComponent("favorite-1", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let orphan = directory.appendingPathComponent("orphan.jpg")
    let interrupted = directory.appendingPathComponent(".partial.import")
    try Data([1]).write(to: orphan)
    try Data([2]).write(to: interrupted)
    try queue.write { db in
      try db.execute(
        sql: """
          INSERT INTO favorite_media (
            id, favorite_id, captured_at, mime_type, media_kind, byte_count, content_hash, created_at
          ) VALUES ('missing', 'favorite-1', 1000, 'image/jpeg', 'photo', 1, '00', 1000)
          """
      )
    }

    XCTAssertTrue(store.list(favoriteId: "favorite-1").isEmpty)
    XCTAssertFalse(FileManager.default.fileExists(atPath: orphan.path))
    XCTAssertFalse(FileManager.default.fileExists(atPath: interrupted.path))
  }

  func testGlobalReconciliationDeletesDirectoryWhoseFavoriteIsGone() throws {
    let orphanDirectory = root.appendingPathComponent("deleted-favorite", isDirectory: true)
    try FileManager.default.createDirectory(at: orphanDirectory, withIntermediateDirectories: true)
    try Data([1]).write(to: orphanDirectory.appendingPathComponent("media.jpg"))

    store.reconcileAll()

    XCTAssertFalse(FileManager.default.fileExists(atPath: orphanDirectory.path))
  }

  private func favorite() -> Favorite {
    Favorite(
      id: "favorite-1",
      boardId: nil,
      name: nil,
      startMs: 1_000,
      endMs: 2_000,
      createdAtMs: 1_000,
      updatedAtMs: 1_000,
      summary: FavoriteSummary()
    )
  }
}
