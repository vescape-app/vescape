import XCTest

@testable import VescapeCore

/// Pins the iOS capture side of the cross-platform Debug Recording contract: line kinds/field
/// names match Android's `SessionRecorder`, and a captured file feeds straight back through the
/// replay decoder (format compatibility for cross-platform replay).
final class SessionRecorderTests: XCTestCase {
  private var directory: URL!

  override func setUpWithError() throws {
    directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("session-recorder-tests-\(UUID().uuidString)", isDirectory: true)
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: directory)
  }

  private func record(_ body: (SessionRecorder) -> Void) throws -> [[String: Any]] {    let store = DebugRecordingStore(directory: directory)
    let recorder = try XCTUnwrap(SessionRecorder(
      store: store,
      deviceName: "Funwheel S/2",
      deviceId: "AA:BB",
      pollIntervalMs: 100
    ))
    recorder.start()
    body(recorder)
    recorder.finish(status: "stopped")
    let url = recorder.fileURL
    let content = try String(contentsOf: url, encoding: .utf8)
    return content.split(separator: "\n").map { line in
      let data = Data(line.utf8)
      return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }
  }

  func testMetaLineCarriesAndroidFieldNames() throws {
    let lines = try record { _ in }
    let meta = lines[0]
    XCTAssertEqual(meta["kind"] as? String, "meta")
    XCTAssertEqual(meta["t"] as? Int, 0)
    XCTAssertEqual(meta["version"] as? Int, 1)
    XCTAssertEqual(meta["deviceName"] as? String, "Funwheel S/2")
    XCTAssertEqual(meta["deviceId"] as? String, "AA:BB")
    XCTAssertEqual(meta["sessionKind"] as? String, "board")
    XCTAssertEqual(meta["pollIntervalMs"] as? Int, 100)
    XCTAssertNotNil(meta["startedAt"] as? Int64)
    XCTAssertEqual(lines[1]["status"] as? String, "recording-started")
    XCTAssertEqual(lines.last?["status"] as? String, "stopped")
  }

  func testFilenameSanitizedLikeAndroid() throws {
    let store = DebugRecordingStore(directory: directory)
    let url = try XCTUnwrap(store.createFile(deviceName: "Fun wheel S/2!"))
    XCTAssertTrue(url.lastPathComponent.hasSuffix("-Fun-wheel-S-2.jsonl"))
    let fallback = try XCTUnwrap(store.createFile(deviceName: "///"))
    XCTAssertTrue(fallback.lastPathComponent.hasSuffix("-vesc-board.jsonl"))
  }

  func testCapturedChunksReplayThroughDecoder() throws {
    let rx: [UInt8] = [0x02, 0x0e, 0x24, 0xff, 0x00]
    let lines = try record { recorder in
      recorder.recordChunk(direction: "tx", bytes: [0x01, 0x02])
      recorder.recordChunk(direction: "rx", bytes: rx)
      recorder.recordState("connected")
    }
    let jsonl = lines.map { line in
      String(data: try! JSONSerialization.data(withJSONObject: line), encoding: .utf8)!
    }.joined(separator: "\n")
    let chunks = ReplayChunkDecoder.rxChunks(jsonl)
    XCTAssertEqual(chunks.count, 1)
    XCTAssertEqual(chunks[0].bytes, rx)
  }

  func testLocationLineOmitsNilFieldsLikeAndroid() throws {
    let lines = try record { recorder in
      recorder.recordLocation(
        latitude: 52.5,
        longitude: 13.25,
        speedMps: nil,
        bearingDeg: 180,
        accuracyM: 3.5,
        altitudeM: nil,
        timestamp: 1_700_000_000_000
      )
    }
    let location = try XCTUnwrap(lines.first { $0["kind"] as? String == "location" })
    XCTAssertEqual(location["latitude"] as? Double, 52.5)
    XCTAssertEqual(location["bearingDeg"] as? Double, 180)
    XCTAssertNil(location["speedMps"])
    XCTAssertNil(location["altitudeM"])
    XCTAssertEqual(location["timestamp"] as? Int64, 1_700_000_000_000)
  }

  func testJsonLineEscapesStrings() {
    let line = SessionRecorder.jsonLine([
      ("t", 5 as Int64),
      ("status", "he said \"hi\"\nback\\slash"),
    ])
    let parsed = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any]
    XCTAssertEqual(parsed?["status"] as? String, "he said \"hi\"\nback\\slash")
  }

  func testListNewestFirstAndExportValidation() throws {
    let store = DebugRecordingStore(directory: directory)
    let first = try XCTUnwrap(store.createFile(deviceName: "one"))
    try Data("a".utf8).write(to: first)
    let second = try XCTUnwrap(store.createFile(deviceName: "two"))
    try Data("bb".utf8).write(to: second)
    // Deterministic modification dates: `list()` sorts newest-first, so avoid depending on
    // filesystem timestamp resolution between two rapid writes.
    try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSince1970: 1_000)], ofItemAtPath: first.path)
    try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSince1970: 2_000)], ofItemAtPath: second.path)

    let listed = try store.list()
    XCTAssertEqual(listed.map { $0["name"] as? String }, [second.lastPathComponent, first.lastPathComponent])
    XCTAssertEqual(listed[0]["sizeBytes"] as? Int64, 2)

    XCTAssertThrowsError(try store.export(name: "../escape.jsonl"))
    XCTAssertThrowsError(try store.export(name: "missing.jsonl"))
    let exported = try store.export(name: second.lastPathComponent)
    XCTAssertEqual(exported["name"] as? String, second.lastPathComponent)
    XCTAssertEqual(exported["sizeBytes"] as? Int64, 2)
  }

  /// BLE chunks are written on the CoreBluetooth callback queue while phone heading arrives from
  /// JS on the module queue — unserialized writes concatenated two objects onto one line and broke
  /// replay of the whole recording.
  func testConcurrentWritesProduceOnlyWellFormedLines() throws {
    let store = DebugRecordingStore(directory: directory)
    let recorder = try XCTUnwrap(SessionRecorder(
      store: store,
      deviceName: "Thor301",
      deviceId: "AA:BB",
      pollIntervalMs: 100
    ))
    recorder.start()

    let threads = 8
    let perThread = 500
    let gate = DispatchSemaphore(value: 0)
    let done = DispatchGroup()
    for index in 0..<threads {
      done.enter()
      Thread {
        gate.wait()
        for i in 0..<perThread {
          if index % 2 == 0 {
            recorder.recordState("probe-\(index * 1000 + i)")
          } else {
            recorder.recordChunk(direction: "rx", bytes: [UInt8(index), UInt8(i % 256)])
          }
        }
        done.leave()
      }.start()
    }
    for _ in 0..<threads { gate.signal() }
    XCTAssertEqual(done.wait(timeout: .now() + 30), .success)
    recorder.finish(status: "stopped")

    let content = try String(contentsOf: recorder.fileURL, encoding: .utf8)
    let lines = content.split(separator: "\n").filter { !$0.isEmpty }
    // meta + recording-started + all writes + stopped
    XCTAssertEqual(lines.count, 3 + threads * perThread)
    for line in lines {
      XCTAssertFalse(line.contains("}{"), "concatenated line: \(line)")
      let parsed = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any]
      XCTAssertNotNil(parsed?["kind"], "malformed line: \(line)")
    }
  }
}
