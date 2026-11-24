import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/config/ConfigRWFsmWriteBaseTest.kt
final class ConfigRWControllerWriteBaseTests: XCTestCase {
  func testProfileReadFailureDoesNotSendFirmwareCommand() {
    let sent = SentFrames()
    var failureCode: String?
    ConfigRWController().consumeWrite(
      profileId: "profile-1",
      connection: connection(fresh(), sent, loadProfile: { _ in throw ProfileReadFailure.failed }),
      onSuccess: { _ in XCTFail("write should not succeed") },
      onError: { code, _ in failureCode = code }
    )

    XCTAssertEqual(failureCode, RefloatConfigErrorCode.CONFIG_READ_FAILED.rawValue)
    XCTAssertTrue(sent.frames.isEmpty)
  }

  func testFreshValuesWriteWithoutReadingFirst() {
    let sent = SentFrames()
    let controller = ConfigRWController()

    controller.consumeWrite(
      profileId: "profile-1",
      connection: connection(fresh(), sent),
      onSuccess: { _ in },
      onError: { code, message in XCTFail("write should not fail: \(code) \(message)") }
    )

    XCTAssertFalse(sent.frames.contains { command($0) == COMM_GET_CUSTOM_CONFIG_XML })
    XCTAssertFalse(sent.frames.contains { command($0) == COMM_GET_CUSTOM_CONFIG })
    XCTAssertTrue(sent.frames.contains { command($0) == COMM_SET_CUSTOM_CONFIG })
  }

  func testWriteKeepsBytesOutsideTheChangedFields() {
    let sent = SentFrames()
    let controller = ConfigRWController()
    let values = fresh()

    controller.consumeChangeset(
      boardId: "board-1",
      changes: ["tuned": 7.0],
      connection: connection(values, sent),
      onSuccess: { _ in },
      onError: { code, message in XCTFail("write should not fail: \(code) \(message)") }
    )

    let base = values.writeBase!
    guard let setFrame = sent.frames.first(where: { command($0) == COMM_SET_CUSTOM_CONFIG }) else {
      return XCTFail("no set frame sent")
    }
    let payload = Array(setFrame.suffix(base.rawConfig.count))
    XCTAssertEqual(payload.count, base.rawConfig.count)
    XCTAssertEqual(Array(setFrame[2..<6]), [0xDE, 0xAD, 0xBE, 0xEF], "signature must come from the retained bytes")
    XCTAssertEqual(Array(payload[4..<8]), Array(base.rawConfig[4..<8]), "untouched field must survive")
    XCTAssertNotEqual(Array(payload[0..<4]), Array(base.rawConfig[0..<4]), "tuned field must change")
  }

  func testProvisionalValuesReadBeforeWriting() throws {
    let sent = SentFrames()
    let controller = ConfigRWController()
    let lastKnown = try BoardConfigValues.lastKnown(
      boardId: "board-1",
      refloatBaseVersion: "3.0.7",
      capturedAtMs: 0,
      valuesJson: "{\"tuned\":1.0}"
    )

    controller.consumeWrite(
      profileId: "profile-1",
      connection: connection(lastKnown, sent),
      onSuccess: { _ in },
      onError: { _, _ in }
    )

    XCTAssertTrue(sent.frames.contains { command($0) == COMM_GET_CUSTOM_CONFIG_XML })
    XCTAssertFalse(sent.frames.contains { command($0) == COMM_SET_CUSTOM_CONFIG })
  }

  func testNoValuesReadBeforeWriting() {
    let sent = SentFrames()
    let controller = ConfigRWController()

    controller.consumeWrite(
      profileId: "profile-1",
      connection: connection(nil, sent),
      onSuccess: { _ in },
      onError: { _, _ in }
    )

    XCTAssertTrue(sent.frames.contains { command($0) == COMM_GET_CUSTOM_CONFIG_XML })
    XCTAssertFalse(sent.frames.contains { command($0) == COMM_SET_CUSTOM_CONFIG })
  }

  func testUntrustedLinkStillRejectsEvenWithFreshValues() {
    let sent = SentFrames()
    var errors: [String] = []
    let controller = ConfigRWController()

    controller.consumeWrite(
      profileId: "profile-1",
      connection: connection(fresh(), sent, linkIntegrity: .outdated),
      onSuccess: { _ in XCTFail("write should not succeed") },
      onError: { code, _ in errors.append(code) }
    )

    XCTAssertEqual(errors, [RefloatConfigErrorCode.LINK_NOT_TRUSTED.rawValue])
    XCTAssertEqual(sent.frames.count, 0)
  }

  func testLinkDropDemotesFreshValuesSoTheyCannotBackAWrite() {
    let demoted = fresh().demotedToProvisional()

    XCTAssertEqual(demoted.freshness, .lastKnown)
    XCTAssertNil(demoted.writeBase)
    XCTAssertEqual(demoted.number("untouched"), 42.0)
  }

  func testEmptyOrNoOpChangesetFinishesWithoutWriting() {
    let sent = SentFrames()
    var completed = 0
    let controller = ConfigRWController()

    controller.consumeChangeset(
      boardId: "board-1",
      changes: [:],
      connection: connection(fresh(), sent),
      onSuccess: { _ in completed += 1 },
      onError: { code, message in XCTFail("empty changeset should not fail: \(code) \(message)") }
    )
    controller.consumeChangeset(
      boardId: "board-1",
      changes: ["tuned": 1.0],
      connection: connection(fresh(), sent),
      onSuccess: { _ in completed += 1 },
      onError: { code, message in XCTFail("no-op changeset should not fail: \(code) \(message)") }
    )

    XCTAssertEqual(completed, 2)
    XCTAssertTrue(sent.frames.isEmpty)
  }

  func testProfilePushDiffsAgainstBoardAtWirePrecisionAndSkipsMatching() {
    let sent = SentFrames()
    var completed = 0
    ConfigRWController().consumeWrite(
      profileId: "profile-1",
      connection: connection(fresh(), sent, loadProfile: { _ in
        ["boardId": "board-1", "refloatBaseVersion": "3.0.7", "fields": ["tuned": 1.0, "untouched": 42.0] as [String: Any]]
      }),
      onSuccess: { _ in completed += 1 },
      onError: { code, message in XCTFail("matching profile should not fail: \(code) \(message)") }
    )

    XCTAssertEqual(completed, 1)
    XCTAssertTrue(sent.frames.isEmpty)
  }

  func testVerifyMismatchDemotesTheWriteBaseAndEmitsDiagnosticAndNextWriteReadsFull() {
    let sent = SentFrames()
    let controller = ConfigRWController()
    var demotions = 0
    var diagnostics: [String] = []
    var errors: [String] = []
    var currentValues: BoardConfigValues? = fresh()
    let conn = connection(
      currentValues,
      sent,
      demoteWriteBase: {
        demotions += 1
        currentValues = currentValues?.demotedToProvisional()
      },
      captureDiagnostic: { name, _ in diagnostics.append(name) }
    )

    controller.consumeWrite(
      profileId: "profile-1",
      connection: conn,
      onSuccess: { _ in XCTFail("write should not succeed") },
      onError: { code, _ in errors.append(code) }
    )
    _ = controller.onPayload([UInt8(COMM_SET_CUSTOM_CONFIG), 0], connection: conn)
    XCTAssertEqual(demotions, 0)
    _ = controller.onPayload([UInt8(COMM_GET_CUSTOM_CONFIG), 0, 0xDE, 0xAD, 0xBE, 0xEF] + fresh().writeBase!.rawConfig, connection: conn)

    XCTAssertEqual(errors, [RefloatConfigErrorCode.CONFIG_VERIFY_FAILED.rawValue])
    XCTAssertEqual(demotions, 1)
    XCTAssertTrue(diagnostics.contains("board_config_write_base_demoted"))

    sent.frames.removeAll()
    controller.consumeChangeset(
      boardId: "board-1",
      changes: ["tuned": 7.0],
      connection: connection(currentValues, sent),
      onSuccess: { _ in },
      onError: { _, _ in }
    )
    XCTAssertTrue(sent.frames.contains { command($0) == COMM_GET_CUSTOM_CONFIG_XML })
    XCTAssertFalse(sent.frames.contains { command($0) == COMM_SET_CUSTOM_CONFIG })
  }

  func testLinkLossAfterSetDemotesTheWriteBase() {
    let sent = SentFrames()
    let controller = ConfigRWController()
    var demotions = 0
    let conn = connection(fresh(), sent, demoteWriteBase: { demotions += 1 })

    controller.consumeWrite(profileId: "profile-1", connection: conn, onSuccess: { _ in }, onError: { _, _ in })
    controller.onSessionTerminated("Board connection lost", connection: conn)

    XCTAssertEqual(demotions, 1)
  }

  func testFailureBeforeSetKeepsTheWriteBase() {
    let sent = SentFrames()
    var demotions = 0
    var errors: [String] = []

    ConfigRWController().consumeChangeset(
      boardId: "board-1",
      changes: ["tuned": 7.0, "unknown_id": 1.0],
      connection: connection(fresh(), sent, demoteWriteBase: { demotions += 1 }),
      onSuccess: { _ in XCTFail("write should not succeed") },
      onError: { code, _ in errors.append(code) }
    )
    ConfigRWController().consumeChangeset(
      boardId: "board-1",
      changes: ["tuned": Double.nan],
      connection: connection(fresh(), sent, demoteWriteBase: { demotions += 1 }),
      onSuccess: { _ in XCTFail("write should not succeed") },
      onError: { code, _ in errors.append(code) }
    )

    XCTAssertEqual(errors, [RefloatConfigErrorCode.CONFIG_VALUE_INVALID.rawValue, RefloatConfigErrorCode.CONFIG_VALUE_INVALID.rawValue])
    XCTAssertEqual(demotions, 0)
    XCTAssertFalse(sent.frames.contains { command($0) == COMM_SET_CUSTOM_CONFIG })
  }

  func testBoardThatIsNotIdleRejectsWriteBeforeAnyFrame() {
    let blocked: [BoardRideState] = [
      BoardRideState(state: 1, switchState: 0, receivedAtMs: wallNowMs()),
      BoardRideState(state: 3, switchState: 0, receivedAtMs: wallNowMs()),
      BoardRideState(state: 0, switchState: 0x08, receivedAtMs: wallNowMs()),
      BoardRideState(state: 0, switchState: 0, receivedAtMs: wallNowMs() - 5_000),
    ]
    for rideState in blocked {
      let sent = SentFrames()
      var errors: [String] = []
      ConfigRWController().consumeChangeset(
        boardId: "board-1",
        changes: ["tuned": 7.0],
        connection: connection(fresh(), sent, rideState: { rideState }),
        onSuccess: { _ in XCTFail("write should not succeed") },
        onError: { code, _ in errors.append(code) }
      )
      XCTAssertEqual(errors, [RefloatConfigErrorCode.BOARD_NOT_IDLE.rawValue], "\(rideState)")
      XCTAssertTrue(sent.frames.isEmpty)
    }
  }

  func testRecheckBeforeSetBlocksWhenTheBoardEngages() {
    let sent = SentFrames()
    var errors: [String] = []
    var demotions = 0
    var checks = 0
    let conn = connection(fresh(), sent, demoteWriteBase: { demotions += 1 }, rideState: {
      checks += 1
      return BoardRideState(state: checks == 1 ? 0 : 1, switchState: 0, receivedAtMs: wallNowMs())
    })

    ConfigRWController().consumeChangeset(
      boardId: "board-1",
      changes: ["tuned": 7.0],
      connection: conn,
      onSuccess: { _ in XCTFail("write should not succeed") },
      onError: { code, _ in errors.append(code) }
    )

    XCTAssertEqual(checks, 2)
    XCTAssertEqual(errors, [RefloatConfigErrorCode.BOARD_NOT_IDLE.rawValue])
    XCTAssertFalse(sent.frames.contains { command($0) == COMM_SET_CUSTOM_CONFIG })
    XCTAssertEqual(demotions, 0)
  }

  func testChangesetWriteAfterALightsEchoKeepsTheNewLightBits() throws {
    let sent = SentFrames()
    let lightsSchema = RefloatConfigSchema(
      hash: "test",
      fields: schema().fields + [
        RefloatConfigSchemaField(id: "leds.on", type: .bool, label: "leds.on", unit: nil, min: nil, max: nil, offset: 8, scale: nil),
        RefloatConfigSchemaField(
          id: "leds.headlights_on", type: .bool, label: "leds.headlights_on", unit: nil, min: nil, max: nil, offset: 9, scale: nil),
      ]
    )
    let raw: [UInt8] = [0x3F, 0x80, 0x00, 0x00, 0x42, 0x28, 0x00, 0x00, 0x00, 0x00]
    let fresh = BoardConfigValues(
      boardId: "board-1",
      refloatBaseVersion: "1.2.1",
      capturedAtMs: 1,
      freshness: .fresh,
      values: RefloatConfigDecoder.decodeFieldMap(schema: lightsSchema, rawConfig: raw),
      writeBase: BoardConfigWriteBase(schema: lightsSchema, rawConfig: raw, packageSignature: 0xDEAD_BEEF)
    )
    let echoed = try XCTUnwrap(try fresh.withLights(enabled: true, headlightsEnabled: true))

    ConfigRWController().consumeChangeset(
      boardId: "board-1",
      changes: ["tuned": 7.0],
      connection: connection(echoed, sent),
      onSuccess: { _ in },
      onError: { code, message in XCTFail("write should not fail: \(code) \(message)") }
    )

    let setFrame = try XCTUnwrap(sent.frames.first { command($0) == COMM_SET_CUSTOM_CONFIG })
    let written = RefloatConfigDecoder.decodeFieldMap(schema: lightsSchema, rawConfig: Array(setFrame.suffix(raw.count)))
    XCTAssertEqual(written["tuned"] as? Double, 7.0)
    XCTAssertEqual(written["leds.on"] as? Bool, true)
    XCTAssertEqual(written["leds.headlights_on"] as? Bool, true)
  }

  func testVerifyPackageSignatureMismatchRejectsAndDemotesWriteBase() {
    let sent = SentFrames()
    let controller = ConfigRWController()
    var demotions = 0
    var errors: [String] = []
    var emittedOrigins: [BoardConfigOperationOrigin] = []
    let conn = connection(
      fresh(),
      sent,
      onBoardConfigValues: { _, origin in emittedOrigins.append(origin) },
      demoteWriteBase: { demotions += 1 }
    )

    controller.consumeChangeset(
      boardId: "board-1",
      changes: ["tuned": 7.0],
      connection: conn,
      onSuccess: { _ in XCTFail("write should not succeed") },
      onError: { code, _ in errors.append(code) }
    )
    let setFrame = sent.frames.first { command($0) == COMM_SET_CUSTOM_CONFIG }!
    let patched = Array(setFrame.suffix(8))
    _ = controller.onPayload([UInt8(COMM_SET_CUSTOM_CONFIG), 0], connection: conn)
    _ = controller.onPayload([UInt8(COMM_GET_CUSTOM_CONFIG), 0, 0x11, 0x22, 0x33, 0x44] + patched, connection: conn)

    XCTAssertEqual(errors, [RefloatConfigErrorCode.CONFIG_VERIFY_FAILED.rawValue])
    XCTAssertEqual(demotions, 1)
    XCTAssertTrue(emittedOrigins.isEmpty)
  }

  func testFreshReadWriteRequiresPostReadIdleSampleAndEmitsFreshReadBeforeVescapeWrite() {
    let scheduler = TestScheduler()
    var now: Int64 = 10_000
    let sent = SentFrames()
    var rideState = BoardRideState(state: 0, switchState: 0, receivedAtMs: now)
    var origins: [BoardConfigOperationOrigin] = []
    var errors: [String] = []
    var succeeded = false
    let controller = ConfigRWController(scheduler: scheduler, nowMs: { now })
    let conn = connection(
      nil,
      sent,
      onBoardConfigValues: { _, origin in origins.append(origin) },
      rideState: { rideState }
    )

    controller.consumeChangeset(
      boardId: "board-1",
      changes: ["tuned": 7.0],
      connection: conn,
      onSuccess: { _ in succeeded = true },
      onError: { code, _ in errors.append(code) }
    )

    let xml = Array("""
      <CustomConfiguration>
        <params>
          <param name="tuned" type="float" min="0" max="100" />
          <param name="untouched" type="float" min="0" max="100" />
        </params>
      </CustomConfiguration>
      """.utf8)
    var xmlPayload: [UInt8] = [UInt8(COMM_GET_CUSTOM_CONFIG_XML), 0]
    xmlPayload.append(contentsOf: int32Bytes(xml.count))
    xmlPayload.append(contentsOf: int32Bytes(0))
    xmlPayload.append(contentsOf: xml)
    let raw: [UInt8] = [0x3F, 0x80, 0x00, 0x00, 0x42, 0x28, 0x00, 0x00]

    now = 15_000
    XCTAssertTrue(controller.onPayload(xmlPayload, connection: conn))
    XCTAssertTrue(controller.onPayload([UInt8(COMM_GET_CUSTOM_CONFIG), 0, 0xDE, 0xAD, 0xBE, 0xEF] + raw, connection: conn))

    XCTAssertEqual(origins, [.freshRead])
    XCTAssertFalse(sent.frames.contains { command($0) == COMM_SET_CUSTOM_CONFIG })

    controller.onRideState(BoardRideState(state: 0, switchState: 0, receivedAtMs: 14_999), connection: conn)
    XCTAssertFalse(sent.frames.contains { command($0) == COMM_SET_CUSTOM_CONFIG })

    now = 15_050
    rideState = BoardRideState(state: 0, switchState: 0, receivedAtMs: 15_050)
    controller.onRideState(rideState, connection: conn)
    guard let setFrame = sent.frames.first(where: { command($0) == COMM_SET_CUSTOM_CONFIG }) else {
      return XCTFail("expected SET frame after post-read idle sample")
    }
    let patched = Array(setFrame.suffix(raw.count))
    XCTAssertTrue(controller.onPayload([UInt8(COMM_SET_CUSTOM_CONFIG), 0], connection: conn))
    XCTAssertTrue(controller.onPayload([UInt8(COMM_GET_CUSTOM_CONFIG), 0, 0xDE, 0xAD, 0xBE, 0xEF] + patched, connection: conn))

    XCTAssertTrue(succeeded)
    XCTAssertTrue(errors.isEmpty)
    XCTAssertEqual(origins, [.freshRead, .vescapeWrite(source: .app, tuneProfileId: nil)])
  }

  func testPreSetRecheckBlocksUntrustedLinkAndExpiresQueuedSetFramesOnTimeout() {
    let scheduler = TestScheduler()
    var now: Int64 = 10_000
    var link: LinkIntegrity = .trusted
    var checks = 0
    let sent = SentFrames()
    var sentTags: [String?] = []
    var cancelledTags: [String] = []
    var errors: [String] = []
    let controller = ConfigRWController(scheduler: scheduler, nowMs: { now })
    let conn = connection(
      fresh(),
      sent,
      liveLinkIntegrity: {
        checks += 1
        return checks >= 2 ? link : .trusted
      },
      sendTaggedPayload: { payload, tag in
        sent.frames.append(payload)
        sentTags.append(tag)
        return true
      },
      cancelQueuedPayloads: { tag in cancelledTags.append(tag) },
      rideState: { BoardRideState(state: 0, switchState: 0, receivedAtMs: now) }
    )

    link = .mismatched
    controller.consumeChangeset(
      boardId: "board-1",
      changes: ["tuned": 7.0],
      connection: conn,
      onSuccess: { _ in XCTFail("write should not succeed") },
      onError: { code, _ in errors.append(code) }
    )
    XCTAssertEqual(errors, [RefloatConfigErrorCode.LINK_NOT_TRUSTED.rawValue])
    XCTAssertTrue(sentTags.isEmpty)

    checks = 0
    link = .trusted
    errors.removeAll()
    controller.consumeChangeset(
      boardId: "board-1",
      changes: ["tuned": 7.0],
      connection: conn,
      onSuccess: { _ in XCTFail("write should not succeed") },
      onError: { code, _ in errors.append(code) }
    )
    XCTAssertEqual(sentTags.count, 1)
    let setTag = sentTags[0]!
    scheduler.advance(10_000)
    XCTAssertEqual(errors, [RefloatConfigErrorCode.CONFIG_WRITE_TIMEOUT.rawValue])
    XCTAssertEqual(cancelledTags, [setTag])
  }

  func testAsyncProfileLoadRevalidatesSessionBeforeStartingWrite() {
    var pendingIo: (() -> Void)?
    var pendingMain: (() -> Void)?
    var active = true
    let sent = SentFrames()
    var errors: [String] = []
    let controller = ConfigRWController(
      profileExecutor: { block in pendingIo = block },
      completeOnSession: { block in pendingMain = block }
    )
    let conn = connection(
      fresh(),
      sent,
      isSessionActive: { active }
    )

    controller.consumeWrite(
      profileId: "profile-1",
      connection: conn,
      onSuccess: { _ in XCTFail("write should not succeed after disconnect") },
      onError: { code, _ in errors.append(code) }
    )
    XCTAssertNotNil(pendingIo)
    XCTAssertTrue(sent.frames.isEmpty)

    pendingIo?()
    active = false
    pendingMain?()

    XCTAssertEqual(errors, [RefloatConfigErrorCode.BOARD_NOT_CONNECTED.rawValue])
    XCTAssertTrue(sent.frames.isEmpty)
  }

  func testProfilePushFiltersInternalFieldsWhileChangesetRejectsThem() {
    let internalSchema = RefloatConfigSchema(
      hash: "internal-filter",
      fields: [
        RefloatConfigSchemaField(id: "tuned", type: .float32, label: "tuned", unit: nil, min: nil, max: nil, offset: 0, scale: nil),
        RefloatConfigSchemaField(id: "meta.is_default", type: .bool, label: "meta.is_default", unit: nil, min: nil, max: nil, offset: 4, scale: nil),
        RefloatConfigSchemaField(id: "group_internal", type: .uint8, label: "group_internal", unit: nil, min: 0, max: 255, offset: 5, scale: nil),
      ],
      groups: [
        RefloatConfigSchemaGroup(
          name: "Internal",
          subgroups: [
            RefloatConfigSchemaSubgroup(name: "Flags", items: [.field("group_internal")]),
          ]
        ),
      ]
    )
    let raw: [UInt8] = [0x3F, 0x80, 0x00, 0x00, 0x01, 0x05]
    let freshInternal = BoardConfigValues(
      boardId: "board-1",
      refloatBaseVersion: "3.0.7",
      capturedAtMs: 1,
      freshness: .fresh,
      values: ["tuned": 1.0, "meta.is_default": true, "group_internal": 5.0],
      writeBase: BoardConfigWriteBase(schema: internalSchema, rawConfig: raw, packageSignature: 0xDEAD_BEEF)
    )

    let profileSent = SentFrames()
    ConfigRWController().consumeWrite(
      profileId: "profile-1",
      connection: connection(freshInternal, profileSent, loadProfile: { _ in
        [
          "boardId": "board-1",
          "refloatBaseVersion": "3.0.7",
          "fields": ["tuned": 7.0, "meta.is_default": false, "group_internal": 99.0] as [String: Any],
        ]
      }),
      onSuccess: { _ in },
      onError: { code, message in XCTFail("profile push should filter internal fields, got \(code) \(message)") }
    )
    XCTAssertTrue(profileSent.frames.contains { command($0) == COMM_SET_CUSTOM_CONFIG })

    let changesetSent = SentFrames()
    var errors: [String] = []
    ConfigRWController().consumeChangeset(
      boardId: "board-1",
      changes: ["tuned": 7.0, "group_internal": 99.0],
      connection: connection(freshInternal, changesetSent),
      onSuccess: { _ in XCTFail("changeset should reject internal fields") },
      onError: { code, _ in errors.append(code) }
    )
    XCTAssertEqual(errors, [RefloatConfigErrorCode.CONFIG_VALUE_INVALID.rawValue])
    XCTAssertFalse(changesetSent.frames.contains { command($0) == COMM_SET_CUSTOM_CONFIG })
  }

  func testExpectedSchemaHashMismatchRejectsBeforeSetOnWriteBaseAndFreshRead() {
    let sent = SentFrames()
    var errors: [String] = []
    var demotions = 0
    ConfigRWController().consumeChangeset(
      boardId: "board-1",
      changes: ["tuned": 7.0],
      expectedSchemaHash: "other-hash",
      connection: connection(fresh(), sent, demoteWriteBase: { demotions += 1 }),
      onSuccess: { _ in XCTFail("write should fail on schema mismatch") },
      onError: { code, _ in errors.append(code) }
    )
    XCTAssertEqual(errors, [RefloatConfigErrorCode.CONFIG_SCHEMA_MISMATCH.rawValue])
    XCTAssertEqual(demotions, 0)
    XCTAssertFalse(sent.frames.contains { command($0) == COMM_SET_CUSTOM_CONFIG })

    let matchingSent = SentFrames()
    ConfigRWController().consumeChangeset(
      boardId: "board-1",
      changes: ["tuned": 7.0],
      expectedSchemaHash: schema().hash,
      connection: connection(fresh(), matchingSent),
      onSuccess: { _ in },
      onError: { code, message in XCTFail("matching schema hash should proceed, got \(code) \(message)") }
    )
    XCTAssertTrue(matchingSent.frames.contains { command($0) == COMM_SET_CUSTOM_CONFIG })

    let freshSent = SentFrames()
    var freshErrors: [String] = []
    let controller = ConfigRWController()
    let conn = connection(nil, freshSent)
    controller.consumeChangeset(
      boardId: "board-1",
      changes: ["tuned": 7.0],
      expectedSchemaHash: "stale-hash",
      connection: conn,
      onSuccess: { _ in XCTFail("fresh read write should fail on schema mismatch") },
      onError: { code, _ in freshErrors.append(code) }
    )
    let xml = Array("""
      <CustomConfiguration>
        <params>
          <param name="tuned" type="float" min="0" max="100" />
          <param name="untouched" type="float" min="0" max="100" />
        </params>
      </CustomConfiguration>
      """.utf8)
    var xmlPayload: [UInt8] = [UInt8(COMM_GET_CUSTOM_CONFIG_XML), 0]
    xmlPayload.append(contentsOf: int32Bytes(xml.count))
    xmlPayload.append(contentsOf: int32Bytes(0))
    xmlPayload.append(contentsOf: xml)
    let raw: [UInt8] = [0x3F, 0x80, 0x00, 0x00, 0x42, 0x28, 0x00, 0x00]
    XCTAssertTrue(controller.onPayload(xmlPayload, connection: conn))
    XCTAssertTrue(controller.onPayload([UInt8(COMM_GET_CUSTOM_CONFIG), 0, 0xDE, 0xAD, 0xBE, 0xEF] + raw, connection: conn))
    XCTAssertEqual(freshErrors, [RefloatConfigErrorCode.CONFIG_SCHEMA_MISMATCH.rawValue])
    XCTAssertFalse(freshSent.frames.contains { command($0) == COMM_SET_CUSTOM_CONFIG })
  }

  private func int32Bytes(_ value: Int) -> [UInt8] {
    [
      UInt8((value >> 24) & 0xff),
      UInt8((value >> 16) & 0xff),
      UInt8((value >> 8) & 0xff),
      UInt8(value & 0xff),
    ]
  }

  private func schema() -> RefloatConfigSchema {
    RefloatConfigSchema(
      hash: "test",
      fields: [
        RefloatConfigSchemaField(id: "tuned", type: .float32, label: "tuned", unit: nil, min: nil, max: nil, offset: 0, scale: nil),
        RefloatConfigSchemaField(id: "untouched", type: .float32, label: "untouched", unit: nil, min: nil, max: nil, offset: 4, scale: nil),
      ]
    )
  }

  private func fresh() -> BoardConfigValues {
    let raw: [UInt8] = [0x3F, 0x80, 0x00, 0x00, 0x42, 0x28, 0x00, 0x00]
    return BoardConfigValues(
      boardId: "board-1",
      refloatBaseVersion: "3.0.7",
      capturedAtMs: 1,
      freshness: .fresh,
      values: ["tuned": 1.0, "untouched": 42.0],
      writeBase: BoardConfigWriteBase(schema: schema(), rawConfig: raw, packageSignature: 0xDEAD_BEEF)
    )
  }

  private func command(_ payload: [UInt8]) -> Int? {
    guard let first = payload.first else { return nil }
    if Int(first) == COMM_FORWARD_CAN, payload.count >= 3 { return Int(payload[2]) }
    return Int(first)
  }

  private func connection(
    _ values: BoardConfigValues?,
    _ sent: SentFrames,
    linkIntegrity: LinkIntegrity = .trusted,
    loadProfile: ((String) throws -> [String: Any?]?)? = nil,
    onBoardConfigValues: @escaping (BoardConfigValues, BoardConfigOperationOrigin) -> Void = { _, _ in },
    demoteWriteBase: @escaping () -> Void = {},
    captureDiagnostic: @escaping (String, [String: Any?]) -> Void = { _, _ in },
    isSessionActive: (() -> Bool)? = nil,
    liveLinkIntegrity: (() -> LinkIntegrity)? = nil,
    sendTaggedPayload: (([UInt8], String?) -> Bool)? = nil,
    cancelQueuedPayloads: @escaping (String) -> Void = { _ in },
    rideState: @escaping () -> BoardRideState? = { BoardRideState(state: 0, switchState: 0, receivedAtMs: wallNowMs()) }
  ) -> ConfigRWConnection {
    ConfigRWConnection(
      phase: .connected,
      appBoardId: "board-1",
      transport: .direct,
      fwVersion: "FW 6.05",
      refloatVersion: "Refloat 3.0.7",
      refloatBaseVersion: "3.0.7",
      linkIntegrity: linkIntegrity,
      boardConfigValues: values,
      isPollingActive: { false },
      stopPolling: {},
      startPolling: {},
      sendPayload: { payload in sent.frames.append(payload); return true },
      captureDiagnostic: captureDiagnostic,
      loadProfile: loadProfile ?? { _ in
        ["boardId": "board-1", "refloatBaseVersion": "3.0.7", "fields": ["tuned": 7.0] as [String: Any]]
      },
      onBoardConfigValues: onBoardConfigValues,
      demoteWriteBase: demoteWriteBase,
      rideState: rideState,
      isSessionActive: isSessionActive,
      liveLinkIntegrity: liveLinkIntegrity,
      sendTaggedPayload: sendTaggedPayload,
      cancelQueuedPayloads: cancelQueuedPayloads
    )
  }
}

private enum ProfileReadFailure: Error { case failed }

private final class SentFrames {
  var frames: [[UInt8]] = []
}

private func wallNowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }
