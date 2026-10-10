import Foundation
import XCTest
@testable import VescapeCore

final class CustomAppSoundsTests: XCTestCase {
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
    let oldManifest = Data("[{\"id\":\"old\",\"name\":\"Old\",\"sounds\":{\"on\":\"\(oldName)\"}}]".utf8)
    let newManifest = Data("[{\"id\":\"new\",\"name\":\"New\",\"sounds\":{\"on\":\"\(newName)\"}}]".utf8)
    try oldManifest.write(to: sounds.appendingPathComponent("packs.json"))
    try Data("old audio".utf8).write(to: sounds.appendingPathComponent(oldName))

    XCTAssertThrowsError(try replacingDatabaseFiles(source: incoming, target: database) { _ in
      try CustomAppSounds.replaceFromBackup(
        ["packs.json": newManifest, newName: Data("new audio".utf8)],
        at: sounds,
        writeEntry: { _, _ in throw CocoaError(.fileWriteNoPermission) }
      )
    } as Void)
    XCTAssertEqual(try Data(contentsOf: database), Data("old database".utf8))
    XCTAssertEqual(try Data(contentsOf: sounds.appendingPathComponent("packs.json")), oldManifest)
    XCTAssertEqual(try Data(contentsOf: sounds.appendingPathComponent(oldName)), Data("old audio".utf8))
    XCTAssertFalse(fm.fileExists(atPath: sounds.appendingPathComponent(newName).path))
  }
}
