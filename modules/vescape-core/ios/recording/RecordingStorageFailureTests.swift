import Foundation
import GRDB
import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/recording/RecordingStorageFailureTest.kt
final class RecordingStorageFailureTests: XCTestCase {
  func testSharedFailureFixtureClassifiesPlatformErrors() throws {
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
    let data = try Data(contentsOf: root.appendingPathComponent("../shared/recording-failure-contract.json"))
    let fixture = try JSONSerialization.jsonObject(with: data) as! [String: Any]
    let scenarios = fixture["scenarios"] as! [[String: Any]]
    for scenario in scenarios {
      let code = ResultCode(rawValue: Int32(scenario["sqliteCode"] as! Int))
      let kind = RecordingStorageFailure.classify(DatabaseError(resultCode: code))
      XCTAssertEqual(kind.rawValue, scenario["expectedKind"] as? String)
      XCTAssertEqual(kind != .writeFailed, scenario["storageUnavailable"] as? Bool)
      let bridgeState = recordingFailureState(kind)
      XCTAssertEqual(bridgeState["kind"] as? String, scenario["expectedKind"] as? String)
      XCTAssertEqual(bridgeState["storageUnavailable"] as? Bool, scenario["storageUnavailable"] as? Bool)
    }
  }

  func testReportIsSanitizedAndEmittedOncePerEpisode() {
    var reports: [RecordingFailureReport] = []
    let reporter = RecordingFailureReporter { reports.append($0) }
    reporter.report(operation: "recording_commit", category: "full_disk", error: DatabaseError(resultCode: .SQLITE_FULL, message: "private SQL and args"))
    reporter.report(operation: "recording_commit", category: "full_disk", error: DatabaseError(resultCode: .SQLITE_FULL, message: "again"))
    XCTAssertEqual(reports, [.init(operation: "recording_commit", category: "full_disk", errorType: "DatabaseError")])
  }

  func testDifferentReadOperationsEachReportOnceWithoutRecordingLabels() {
    var reports: [RecordingFailureReport] = []
    let reporter = RecordingFailureReporter { reports.append($0) }
    reporter.report(operation: "history_page_read", category: "query_failed", error: DatabaseError(resultCode: .SQLITE_ERROR))
    reporter.report(operation: "history_page_read", category: "query_failed", error: DatabaseError(resultCode: .SQLITE_ERROR))
    reporter.report(operation: "profile_stats_read", category: "query_failed", error: DatabaseError(resultCode: .SQLITE_ERROR))
    XCTAssertEqual(reports.map(\.operation), ["history_page_read", "profile_stats_read"])
    XCTAssertEqual(reports.map(\.category), ["query_failed", "query_failed"])
  }

  func testWriteGateStopsIngestionAndReportsOnce() {
    var reports = 0
    let gate = RecordingWriteGate { _ in reports += 1 }
    XCTAssertTrue(gate.isAccepting())
    gate.fail(DatabaseError(resultCode: .SQLITE_ERROR))
    gate.fail(DatabaseError(resultCode: .SQLITE_FULL))
    XCTAssertFalse(gate.isAccepting())
    XCTAssertEqual(reports, 1)
  }


  func testGenericFailureCannotHideABroadOutage() {
    XCTAssertEqual(resolveRecordingFailureKind(current: .fullDisk, incoming: .writeFailed), .fullDisk)
  }

  func testReporterCallsSinkOutsideDedupLock() {
    var operations: [String] = []
    var reporter: RecordingFailureReporter!
    reporter = RecordingFailureReporter { report in
      operations.append(report.operation)
      if report.operation == "first" {
        reporter.report(operation: "second", category: "query_failed", error: DatabaseError(resultCode: .SQLITE_ERROR))
      }
    }
    reporter.report(operation: "first", category: "query_failed", error: DatabaseError(resultCode: .SQLITE_ERROR))
    XCTAssertEqual(operations, ["first", "second"])
  }

  func testSuccessfulSuspendedStartupProbeDoesNotEraseRuntimeOutage() {
    RecordingStorageFailure.resetForTesting()
    let entered = DispatchSemaphore(value: 0)
    let resume = DispatchSemaphore(value: 0)
    let finished = expectation(description: "startup probe")
    DispatchQueue.global().async {
      RecordingStorageFailure.startupCheck {
        entered.signal()
        resume.wait()
      }
      finished.fulfill()
    }
    XCTAssertEqual(entered.wait(timeout: .now() + 1), .success)
    RecordingStorageFailure.reportRead(
      operation: "runtime_read_during_startup",
      error: DatabaseError(resultCode: .SQLITE_IOERR)
    )
    resume.signal()
    wait(for: [finished], timeout: 1)
    XCTAssertEqual(RecordingStorageFailure.value(), .storageUnavailable)
    RecordingStorageFailure.resetForTesting()
  }
}
