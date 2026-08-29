import XCTest

@testable import VescapeCore

private let emptyOutput = "No faults registered since startup\n"

private let oneFault = """

  Fault            : FAULT_CODE_ABS_OVER_CURRENT
  Motor            : 1
  Current          : 121.3
  Current filtered : 98.4
  Voltage          : 50.21
  Duty             : 0.812
  RPM              : 7412.0
  Tacho            : 91231
  Cycles running   : 4123
  TIM duty         : 100
  TIM val samp     : 50
  TIM current samp : 25
  TIM top          : 200
  Comm step        : 0
  Temperature      : 41.20

  """

private let twoFaults =
  oneFault
  + "\n\nFault            : FAULT_CODE_OVER_TEMP_FET\nMotor            : 1\nTemperature      : 101.00\n"

/// The read-only `faults` request carries the fixed literal on both transports, so a CAN-forwarded
/// Refloat Board asks the same controller the Board Link proved.
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/faults/VescFaultRegisterTest.kt `VescFaultRegisterFramingTest`
final class VescFaultRegisterFramingTests: XCTestCase {
  func testDirectFramingSendsOnlyTheFixedLiteral() {
    let frame = buildFaultsTerminalCommand(.direct)
    XCTAssertEqual(Int(frame[0]), 20)
    XCTAssertEqual(String(decoding: frame[1...], as: UTF8.self), "faults")
  }

  func testCanFramingForwardsTheSameLiteral() {
    let frame = buildFaultsTerminalCommand(.can(42))
    XCTAssertEqual(Int(frame[0]), 34)
    XCTAssertEqual(Int(frame[1]), 42)
    XCTAssertEqual(Int(frame[2]), 20)
    XCTAssertEqual(String(decoding: frame[3...], as: UTF8.self), "faults")
  }
}

/// Parsing keeps everything the firmware printed and refuses to invent an empty register.
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/faults/VescFaultRegisterTest.kt `VescFaultRegisterParserTest`
final class VescFaultRegisterParserTests: XCTestCase {
  func testExplicitNoFaultsOutputProvesAnEmptyRegister() {
    XCTAssertEqual(VescFaultRegisterParser.parse(emptyOutput)?.count, 0)
  }

  func testUnrecognisedOutputIsNotAnEmptyRegister() {
    XCTAssertNil(VescFaultRegisterParser.parse("Unknown command\n"))
  }

  func testACompleteBlockParsesItsCodeNameAndEveryField() throws {
    let entries = try XCTUnwrap(VescFaultRegisterParser.parse(oneFault))
    XCTAssertEqual(entries.count, 1)
    let entry = entries[0]
    XCTAssertEqual(entry.code, 4)
    XCTAssertEqual(entry.name, "FAULT_CODE_ABS_OVER_CURRENT")
    XCTAssertEqual(entry.position, 0)
    XCTAssertEqual(entry.fields.first { $0.label == "Current" }?.value, "121.3")
    XCTAssertEqual(entry.fields.first { $0.label == "Temperature" }?.value, "41.20")
  }

  func testMultipleBlocksKeepControllerOrder() throws {
    let entries = try XCTUnwrap(VescFaultRegisterParser.parse(twoFaults))
    XCTAssertEqual(entries.map { $0.position }, [0, 1])
    XCTAssertEqual(entries.map { $0.code }, [4, 5])
  }

  func testUnknownLabelsAndUnknownFaultNamesSurvive() throws {
    let text = "Fault            : FAULT_CODE_FUTURE_THING\nSome New Label   : 7\nfree form line\n"
    let entry = try XCTUnwrap(VescFaultRegisterParser.parse(text)?.first)
    XCTAssertNil(entry.code)
    XCTAssertEqual(entry.name, "FAULT_CODE_FUTURE_THING")
    XCTAssertEqual(entry.fields.first { $0.label == "Some New Label" }?.value, "7")
    XCTAssertTrue(entry.fields.contains { $0.value == "free form line" })
    XCTAssertTrue(entry.rawBlock.contains("free form line"))
  }
}

/// The bounded completion policy: an idle boundary completes, the hard bound never does.
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/faults/VescFaultRegisterTest.kt `VescFaultRegisterReaderTest`
final class VescFaultRegisterReaderTests: XCTestCase {
  func testOutputSettlingForAFullIdleBoundaryCompletesTheRead() throws {
    let reader = VescFaultRegisterReader(boardId: "b", reason: .connect, startedAtMs: 0)
    reader.onPrintChunk(Array("No faults".utf8), atMs: 100)
    reader.onPrintChunk(Array(" registered".utf8), atMs: 200)
    XCTAssertNil(reader.poll(400))
    let read = try XCTUnwrap(reader.poll(700))
    XCTAssertEqual(read.status, .complete)
    XCTAssertEqual(read.text, "No faults registered")
  }

  func testChunkBoundariesAreReassembledByteForByte() throws {
    let reader = VescFaultRegisterReader(boardId: "b", reason: .connect, startedAtMs: 0)
    let bytes = Array(oneFault.utf8)
    var index = 0
    var at: Int64 = 0
    while index < bytes.count {
      let end = min(index + 17, bytes.count)
      reader.onPrintChunk(Array(bytes[index..<end]), atMs: at)
      index = end
      at += 10
    }
    let read = try XCTUnwrap(reader.poll(2_000))
    XCTAssertEqual(read.text, oneFault)
    XCTAssertEqual(read.status, .complete)
  }

  func testTheHardBoundNeverSynthesizesCompletion() throws {
    let reader = VescFaultRegisterReader(boardId: "b", reason: .connect, startedAtMs: 0)
    var at: Int64 = 0
    while at < VescFaultRegisterReader.hardBoundMs {
      at += 100
      reader.onPrintChunk(Array("x".utf8), atMs: at)
      if at < VescFaultRegisterReader.hardBoundMs { XCTAssertNil(reader.poll(at)) }
    }
    let read = try XCTUnwrap(reader.poll(VescFaultRegisterReader.hardBoundMs))
    XCTAssertEqual(read.status, .incomplete)
    XCTAssertFalse(read.raw.isEmpty)
  }

  func testAReadThatNeverAnsweredIsIncompleteAndEmpty() throws {
    let reader = VescFaultRegisterReader(boardId: "b", reason: .idle, startedAtMs: 0)
    XCTAssertNil(reader.poll(1_000))
    let read = try XCTUnwrap(reader.poll(VescFaultRegisterReader.hardBoundMs))
    XCTAssertEqual(read.status, .incomplete)
    XCTAssertEqual(read.raw.count, 0)
  }

  func testSessionLossKeepsThePartialBytesAsIncompleteEvidence() throws {
    let reader = VescFaultRegisterReader(boardId: "b", reason: .predisconnect, startedAtMs: 0)
    reader.onPrintChunk(Array("Fault".utf8), atMs: 10)
    let read = try XCTUnwrap(reader.finishIncomplete())
    XCTAssertEqual(read.status, .incomplete)
    XCTAssertEqual(read.text, "Fault")
    XCTAssertTrue(reader.isFinished)
  }
}

/// Terminal reads are rare by construction: one per stop, spaced, and never while moving.
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/faults/VescFaultRegisterTest.kt `VescFaultAuditPolicyTest`
final class VescFaultAuditPolicyTests: XCTestCase {
  func testStandingStillIsOneAuditOpportunityNotOnePerFrame() {
    let policy = VescFaultAuditPolicy()
    XCTAssertNil(policy.observe(0, speedKmh: 0))
    XCTAssertNil(policy.observe(4_000, speedKmh: 0))
    XCTAssertEqual(policy.observe(6_000, speedKmh: 0), .stationary)
    policy.onAuditStarted(6_000)
    XCTAssertNil(policy.observe(7_000, speedKmh: 0))
    XCTAssertNil(policy.observe(200_000, speedKmh: 0))
  }

  func testRidingAgainEarnsTheNextStopItsOwnAudit() {
    let policy = VescFaultAuditPolicy()
    _ = policy.observe(0, speedKmh: 0)
    XCTAssertEqual(policy.observe(6_000, speedKmh: 0), .stationary)
    policy.onAuditStarted(6_000)
    _ = policy.observe(10_000, speedKmh: 24)
    XCTAssertNil(policy.observe(60_000, speedKmh: 0))
    XCTAssertEqual(policy.observe(70_000, speedKmh: 0), .stationary)
  }

  func testMovingIsNeverASafeAuditOpportunity() {
    let policy = VescFaultAuditPolicy()
    for at in 0...40 { XCTAssertNil(policy.observe(Int64(at) * 1_000, speedKmh: 18)) }
  }
}

private final class FakeSnapshotStore: VescFaultRegisterStoring {
  var rows: [VescFaultRegisterSnapshot] = []

  @discardableResult
  func insert(_ snapshot: VescFaultRegisterSnapshot) -> Bool {
    rows.append(snapshot)
    return true
  }

  func getForBoard(_ boardId: String, limit: Int) -> [VescFaultRegisterSnapshot] {
    Array(rows.filter { $0.boardId == boardId }.reversed().prefix(limit))
  }

  func get(_ id: String) -> VescFaultRegisterSnapshot? { rows.first { $0.id == id } }

  func latestComplete(_ boardId: String) -> VescFaultRegisterSnapshot? {
    rows.last { $0.boardId == boardId && $0.status == .complete }
  }

  func hasBaseline(_ boardId: String) -> Bool {
    rows.contains { $0.boardId == boardId && $0.reason == .baseline }
  }
}

private final class FakeFaultStore: VescFaultStoring {
  var rows: [String: VescFaultOccurrence] = [:]
  var order: [String] = []

  var all: [VescFaultOccurrence] { order.compactMap { rows[$0] } }

  func getForBoard(_ boardId: String) -> [VescFaultOccurrence] {
    all.filter { $0.boardId == boardId }
  }

  func getAll() -> [VescFaultOccurrence] { all }

  func openLive(_ boardId: String) -> VescFaultOccurrence? {
    all.last { $0.boardId == boardId && $0.source == .live && $0.clearedAtMs == nil }
  }

  @discardableResult
  func upsert(_ occurrence: VescFaultOccurrence) -> Bool {
    if rows[occurrence.id] == nil { order.append(occurrence.id) }
    rows[occurrence.id] = occurrence
    return true
  }

  @discardableResult
  func setDismissed(_ id: String, _ dismissed: Bool) -> Bool {
    guard var row = rows[id] else { return false }
    row.dismissed = dismissed
    rows[id] = row
    return true
  }
}

/// Folding register reads into Board-owned evidence: baselines are discarded, unchanged bytes never
/// duplicate, incomplete output proves nothing, and only an unambiguous single unseen entry may
/// enrich the open live occurrence.
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/faults/VescFaultRegisterTest.kt `VescFaultRegisterCoordinatorTest`
final class VescFaultRegisterCoordinatorTests: XCTestCase {
  private var snapshots = FakeSnapshotStore()
  private var faultStore = FakeFaultStore()
  private var clock: Int64 = 1_000
  private var ids = 0
  private var faults: VescFaultCoordinator!
  private var coordinator: VescFaultRegisterCoordinator!

  override func setUp() {
    super.setUp()
    snapshots = FakeSnapshotStore()
    faultStore = FakeFaultStore()
    clock = 1_000
    ids = 0
    faults = VescFaultCoordinator(
      store: faultStore, now: { [unowned self] in self.clock },
      newId: { [unowned self] in defer { self.ids += 1 }; return "f\(self.ids)" }
    )
    coordinator = VescFaultRegisterCoordinator(
      snapshots: snapshots, faults: faults, now: { [unowned self] in self.clock },
      newId: { [unowned self] in defer { self.ids += 1 }; return "s\(self.ids)" }
    )
  }

  private func read(
    _ text: String, reason: VescFaultRegisterReason = .connect,
    status: VescFaultRegisterStatus = .complete
  ) -> VescFaultRegisterRead {
    VescFaultRegisterRead(reason: reason, status: status, raw: Data(text.utf8), text: text)
  }

  func testAFirstReadIsTheBoardsBaselineAndItsEntriesAreDiscardedEvidence() {
    XCTAssertEqual(coordinator.connectReason("board"), .baseline)
    let record = coordinator.record(boardId: "board", read: read(twoFaults, reason: .baseline))
    XCTAssertEqual(record.baselineCount, 2)
    let occurrences = faultStore.getForBoard("board")
    XCTAssertEqual(occurrences.count, 2)
    XCTAssertTrue(occurrences.allSatisfy { $0.source == .baseline })
    XCTAssertTrue(occurrences.allSatisfy { $0.dismissed })
    XCTAssertTrue(occurrences.allSatisfy { $0.occurredAtMs == nil })
    XCTAssertEqual(occurrences.map { $0.registerPosition }, [0, 1])
    XCTAssertEqual(coordinator.connectReason("board"), .connect)
  }

  func testReLinkingReplacesTheComparisonBaseline() {
    coordinator.record(boardId: "board", read: read(oneFault, reason: .baseline))
    coordinator.requestBaseline("board")
    XCTAssertEqual(coordinator.connectReason("board"), .baseline)
  }

  func testUnchangedEvidenceNeverDuplicates() {
    coordinator.record(boardId: "board", read: read(twoFaults, reason: .baseline))
    let again = coordinator.record(boardId: "board", read: read(twoFaults, reason: .stationary))
    XCTAssertTrue(again.unchanged)
    XCTAssertEqual(again.createdCount, 0)
    XCTAssertEqual(snapshots.rows.count, 1)
    XCTAssertEqual(faultStore.getForBoard("board").count, 2)
  }

  func testANewlyAppendedEntryBecomesARegisterDiscoveredOccurrence() throws {
    coordinator.record(boardId: "board", read: read(oneFault, reason: .baseline))
    clock = 5_000
    let record = coordinator.record(boardId: "board", read: read(twoFaults, reason: .stationary))
    XCTAssertEqual(record.createdCount, 1)
    let discovered = try XCTUnwrap(faultStore.getForBoard("board").last)
    XCTAssertEqual(discovered.source, .register)
    XCTAssertNil(discovered.occurredAtMs)
    XCTAssertEqual(discovered.discoveredAtMs, 5_000)
    XCTAssertEqual(discovered.registerPosition, 1)
    XCTAssertFalse(discovered.dismissed)
  }

  func testOneUnseenEntryFromALiveReadEnrichesTheOpenOccurrence() throws {
    coordinator.record(boardId: "board", read: read(oneFault, reason: .baseline))
    faults.onActiveFault(boardId: "board", code: 8)
    let open = try XCTUnwrap(faultStore.openLive("board"))
    let record = coordinator.record(boardId: "board", read: read(twoFaults, reason: .live))
    XCTAssertEqual(record.enrichedOccurrenceId, open.id)
    // No extra occurrence: the entry became context on the activation Vescape already had.
    XCTAssertEqual(faultStore.getAll().count, 2)
    let enriched = try XCTUnwrap(faultStore.rows[open.id])
    XCTAssertEqual(enriched.registerPosition, 1)
    XCTAssertNotNil(enriched.registerSnapshotId)
  }

  func testTwoUnseenEntriesStaySeparateRatherThanGuessing() {
    coordinator.record(boardId: "board", read: read(emptyOutput, reason: .baseline))
    faults.onActiveFault(boardId: "board", code: 8)
    let record = coordinator.record(boardId: "board", read: read(twoFaults, reason: .live))
    XCTAssertNil(record.enrichedOccurrenceId)
    XCTAssertEqual(record.createdCount, 2)
    XCTAssertEqual(faultStore.getAll().filter { $0.source == .register }.count, 2)
  }

  func testIncompleteOutputIsRetainedButProvesNothing() throws {
    let record = coordinator.record(
      boardId: "board",
      read: read("Fault            : FAULT_CODE_DRV\n", reason: .live, status: .incomplete)
    )
    XCTAssertEqual(record.createdCount, 0)
    let snapshot = try XCTUnwrap(record.snapshot)
    XCTAssertNil(snapshot.entries)
    XCTAssertEqual(faultStore.getAll().count, 0)
    // And it is not the comparison baseline: the next complete read still diffs against nothing.
    XCTAssertNil(snapshots.latestComplete("board"))
  }

  func testAReadThatNeverAnsweredIsNotStoredAtAll() {
    let record = coordinator.record(
      boardId: "board",
      read: VescFaultRegisterRead(reason: .idle, status: .incomplete, raw: Data(), text: "")
    )
    XCTAssertNil(record.snapshot)
    XCTAssertEqual(snapshots.rows.count, 0)
  }

  func testUnparseableCompleteOutputKeepsItsBytes() throws {
    let record = coordinator.record(
      boardId: "board", read: read("garbage from a future firmware"))
    let snapshot = try XCTUnwrap(record.snapshot)
    XCTAssertNil(snapshot.entries)
    XCTAssertEqual(snapshot.text, "garbage from a future firmware")
    XCTAssertEqual(faultStore.getAll().count, 0)
  }

  func testAnEmptyCompleteRegisterCreatesNothing() throws {
    let record = coordinator.record(boardId: "board", read: read(emptyOutput, reason: .baseline))
    XCTAssertEqual(record.baselineCount, 0)
    XCTAssertEqual(try XCTUnwrap(record.snapshot).entries?.count, 0)
    XCTAssertEqual(faultStore.getAll().count, 0)
  }

  func testTheCollectionKillSwitchStopsEveryRegisterWrite() {
    faults.collectionEnabled = false
    let record = coordinator.record(boardId: "board", read: read(twoFaults, reason: .baseline))
    XCTAssertNil(record.snapshot)
    XCTAssertEqual(snapshots.rows.count, 0)
    XCTAssertEqual(faultStore.getAll().count, 0)
  }
}
