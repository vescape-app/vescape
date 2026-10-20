import Foundation
import XCTest
@testable import VescapeCore

final class MySoundsTests: XCTestCase {
  func testFailedSoundInstallAfterDatabaseCopyRestoresBothStores() throws {
    let fm = FileManager.default
    let work = fm.temporaryDirectory.appendingPathComponent("sound-restore-\(UUID().uuidString)")
    try fm.createDirectory(at: work, withIntermediateDirectories: true)
    defer { try? fm.removeItem(at: work) }
    let database = work.appendingPathComponent("vescape.db")
    let incoming = work.appendingPathComponent("incoming.db")
    try Data("old database".utf8).write(to: database)
    try Data("new database".utf8).write(to: incoming)

    let sounds = work.appendingPathComponent("custom-app-sounds")
    try fm.createDirectory(at: sounds, withIntermediateDirectories: true)
    let oldName = "11111111-1111-1111-1111-111111111111.wav"
    let newName = "22222222-2222-2222-2222-222222222222.wav"
    let oldManifest = Data("{\"sounds\":[{\"id\":\"\(oldName.dropLast(4))\",\"name\":\"Old\"}],\"overrides\":{}}".utf8)
    let newManifest = Data("{\"sounds\":[{\"id\":\"\(newName.dropLast(4))\",\"name\":\"New\"}],\"overrides\":{}}".utf8)
    try oldManifest.write(to: sounds.appendingPathComponent("my-sounds.json"))
    try Data("old audio".utf8).write(to: sounds.appendingPathComponent(oldName))

    XCTAssertThrowsError(try replacingDatabaseFiles(source: incoming, target: database) { _ in
      try MySounds.replaceFromBackup(
        ["my-sounds.json": newManifest, newName: Data("new audio".utf8)],
        at: sounds,
        writeEntry: { _, _ in throw CocoaError(.fileWriteNoPermission) }
      )
    } as Void)
    XCTAssertEqual(try Data(contentsOf: database), Data("old database".utf8))
    XCTAssertEqual(try Data(contentsOf: sounds.appendingPathComponent("my-sounds.json")), oldManifest)
    XCTAssertEqual(try Data(contentsOf: sounds.appendingPathComponent(oldName)), Data("old audio".utf8))
    XCTAssertFalse(fm.fileExists(atPath: sounds.appendingPathComponent(newName).path))
  }
}
