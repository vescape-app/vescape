import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/appstatus/AppStatusTest.kt
final class AppStatusTests: XCTestCase {
  private let currentVersion = #"{"installed":"0.80.2","latest":"0.80.2","status":"current"}"#

  private func body(_ version: String, messages: String = "[]") -> Data {
    Data(#"{"version":\#(version),"messages":\#(messages)}"#.utf8)
  }

  func testDecodesAResolvedUpdateWarning() {
    let status = decodeAppStatus(
      body(#"{"installed":"0.70.0","latest":"0.80.2","status":"update-warning","message":"**Update**"}"#)
    )

    XCTAssertEqual(status?.version.installed, "0.70.0")
    XCTAssertEqual(status?.version.latest, "0.80.2")
    XCTAssertEqual(status?.version.status, .updateWarning)
    XCTAssertEqual(status?.version.message, "**Update**")
    XCTAssertEqual(status?.messages, [CommunityMessage]())
  }

  func testDecodesEveryResolvedStatusSlug() {
    let slugs: [(String, AppVersionStatus)] = [
      ("current", .current),
      ("update-warning", .updateWarning),
      ("online-blocked", .onlineBlocked),
      ("app-blocked", .appBlocked),
    ]
    for (slug, expected) in slugs {
      let status = decodeAppStatus(body(#"{"installed":"0.1.0","latest":"0.80.2","status":"\#(slug)"}"#))
      XCTAssertEqual(status?.version.status, expected, slug)
    }
  }

  func testDecodesCommunityMessagesWithAndWithoutAnAction() {
    let status = decodeAppStatus(
      body(
        currentVersion,
        messages: """
        [
          {"id":"m1","type":"critical","title":"Relay outage","body":"Relay down",
           "action":{"type":"primary","label":"Status","url":"https://vescape.app/status"}},
          {"id":"m2","type":"info","body":"Hello"}
        ]
        """
      )
    )

    XCTAssertEqual(status?.messages.count, 2)
    XCTAssertEqual(status?.messages.first?.type, .critical)
    XCTAssertEqual(status?.messages.first?.title, "Relay outage")
    XCTAssertNil(status?.messages.last?.title)
    XCTAssertEqual(status?.messages.first?.action?.type, .primary)
    XCTAssertEqual(status?.messages.first?.action?.url, "https://vescape.app/status")
    XCTAssertNil(status?.messages.last?.action)
  }

  func testIgnoresUnknownAdditiveFields() {
    let status = decodeAppStatus(
      Data(
        """
        {"version":{"installed":"0.80.2","latest":"0.80.2","status":"current","futureField":1},
         "messages":[{"id":"m1","type":"info","body":"Hi","futureField":true}],
         "futureSection":{"a":1}}
        """.utf8
      )
    )

    XCTAssertEqual(status?.version.status, .current)
    XCTAssertEqual(status?.messages.count, 1)
  }

  func testRejectsInvalidRequiredShapes() {
    let invalid: [Data] = [
      Data("not json".utf8),
      Data(#"{"messages":[]}"#.utf8),
      body(#"{"latest":"0.80.2","status":"current"}"#),
      body(#"{"installed":"0.80.2","status":"current"}"#),
      body(#"{"installed":"0.80.2","latest":"0.80.2"}"#),
      body(#"{"installed":"0.80.2","latest":"0.80.2","status":"retired"}"#),
      body(#"{"installed":"","latest":"0.80.2","status":"current"}"#),
      body(#"{"installed":1,"latest":"0.80.2","status":"current"}"#),
      body(#"{"installed":"0.80.2","latest":"0.80.2","status":"current","message":42}"#),
    ]

    for json in invalid {
      XCTAssertNil(decodeAppStatus(json), String(decoding: json, as: UTF8.self))
    }
  }

  func testAnUnusableMessagesFieldMeansNoMessagesNeverAFailedStatus() {
    let withoutMessages: [Data] = [
      Data(#"{"version":\#(currentVersion)}"#.utf8),
      body(currentVersion, messages: "null"),
      body(currentVersion, messages: #"{"m1":"Hi"}"#),
    ]

    for json in withoutMessages {
      let status = decodeAppStatus(json)
      XCTAssertEqual(status?.version.status, .current, String(decoding: json, as: UTF8.self))
      XCTAssertEqual(status?.messages, [CommunityMessage]())
    }
  }

  func testSkipsInvalidIndividualMessagesWithoutFailingTheWholeStatus() {
    let status = decodeAppStatus(
      body(
        currentVersion,
        messages: """
        [
          {"type":"info","body":"no id"},
          {"id":"ok","type":"warning","body":"valid"},
          {"id":"bad-type","type":"shout","body":"Hi"},
          {"id":"bad-action","type":"info","body":"Hi","action":{"type":"primary"}},
          {"id":"bad-title","type":"info","title":42,"body":"Hi"},
          {"id":"tertiary","type":"info","body":"Hi","action":{"type":"tertiary","label":"a","url":"b"}},
          "notAnObject"
        ]
        """
      )
    )

    XCTAssertEqual(status?.version.status, .current)
    XCTAssertEqual(status?.messages.map { $0.id }, ["ok"])
  }

  func testMapsTheBridgePayload() {
    let map = decodeAppStatus(
      body(
        #"{"installed":"0.70.0","latest":"0.80.2","status":"update-warning","message":"Update"}"#,
        messages: #"[{"id":"m1","type":"warning","body":"Hi","action":{"type":"secondary","label":"Read","url":"https://vescape.app"}}]"#
      )
    )?.toMap()

    let version = map?["version"] as? [String: Any?]
    XCTAssertEqual(version?["installed"] as? String, "0.70.0")
    XCTAssertEqual(version?["latest"] as? String, "0.80.2")
    XCTAssertEqual(version?["status"] as? String, "update-warning")
    XCTAssertEqual(version?["message"] as? String, "Update")

    let messages = map?["messages"] as? [[String: Any?]]
    XCTAssertEqual(messages?.count, 1)
    XCTAssertEqual(messages?.first?["id"] as? String, "m1")
    XCTAssertEqual(messages?.first?["type"] as? String, "warning")
    let action = messages?.first?["action"] as? [String: Any?]
    XCTAssertEqual(action?["type"] as? String, "secondary")
    XCTAssertEqual(action?["label"] as? String, "Read")
    XCTAssertEqual(action?["url"] as? String, "https://vescape.app")
  }
}
