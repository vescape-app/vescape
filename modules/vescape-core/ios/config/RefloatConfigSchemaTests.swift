import XCTest
@testable import VescapeCore

final class RefloatConfigSchemaTests: XCTestCase {
  private func parseFixture(_ version: String) throws -> RefloatConfigSchema {
    let root = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
    let data = try Data(
      contentsOf: root.appendingPathComponent("shared/fixtures/refloat-schema/settings-\(version).xml.zlib")
    )
    return try RefloatConfigSchemaParser.parse([UInt8](data))
  }
  func testDocumentTypeDetectionIgnoresCommentsAndCdata() {
    XCTAssertFalse(RefloatConfigSchemaParser.containsDocumentType(
      "<root><!-- <!DOCTYPE fake> --><![CDATA[<!DOCTYPE fake>]]></root>"
    ))
    XCTAssertTrue(RefloatConfigSchemaParser.containsDocumentType("<!DOCTYPE root><root/>"))
    XCTAssertTrue(RefloatConfigSchemaParser.containsDocumentType(
      "<!DOCTYPE root SYSTEM 'https://example.invalid/entity'><root/>"
    ))
  }
  func testParsesParamsFromVescStyleXml() throws {
    let xml = """
      <CustomConfiguration>
        <params>
          <param name="kp" type="float" min="0" max="100" unit="" label="Angle P" />
          <param name="kp2" type="float" min="0" max="5" unit="" label="Rate P" />
          <param name="quickstop_enabled" type="bool" label="Quickstop" />
        </params>
      </CustomConfiguration>
      """

    let schema = try RefloatConfigSchemaParser.parse(Array(xml.utf8))

    XCTAssertEqual("kp", schema.fields[0].id)
    XCTAssertEqual(.float32, schema.fields[0].type)
    XCTAssertEqual(0, schema.fields[0].min)
    XCTAssertEqual(100, schema.fields[0].max)
    XCTAssertEqual("Angle P", schema.fields[0].label)
    XCTAssertEqual(.bool, schema.fields[2].type)
    XCTAssertFalse(schema.hash.isEmpty)
  }

  func testParsesConfigParamsUsingSerializedStructNames() throws {
    let xml = """
      <ConfigParams>
        <Params>
          <atr_strength_up>
            <type>1</type>
            <vTx>8</vTx>
            <vTxDoubleScale>1000</vTxDoubleScale>
            <longName>ATR Uphill Strength</longName>
          </atr_strength_up>
          <turntilt_erpm_boost>
            <type>2</type>
            <vTx>3</vTx>
            <longName>Speed Boost %</longName>
          </turntilt_erpm_boost>
        </Params>
        <SerOrder>
          <ser>atr_strength_up</ser>
          <ser>turntilt_erpm_boost</ser>
        </SerOrder>
      </ConfigParams>
      """

    let schema = try RefloatConfigSchemaParser.parse(Array(xml.utf8))

    XCTAssertEqual("atr_strength_up", schema.fields[0].id)
    XCTAssertEqual(.float32Scaled, schema.fields[0].type)
    XCTAssertEqual(1000, schema.fields[0].scale)
    XCTAssertEqual("turntilt_erpm_boost", schema.fields[1].id)
    XCTAssertEqual(.uint16, schema.fields[1].type)
  }

  func testRejectsMissingFieldNames() {
    XCTAssertThrowsError(
      try RefloatConfigSchemaParser.parse(Array("<CustomConfiguration><params><param type=\"float\" /></params></CustomConfiguration>".utf8))
    )
  }

  func testWrapsMalformedXmlAsSchemaError() {
    XCTAssertThrowsError(try RefloatConfigSchemaParser.parse(Array("<CustomConfiguration><params>".utf8)))
  }

  func testRejectsDuplicateFieldIdsWithTypedError() {
    let duplicateInParams = """
      <ConfigParams>
        <Params>
          <kp><type>1</type><vTx>7</vTx><vTxDoubleScale>10</vTxDoubleScale></kp>
          <kp><type>1</type><vTx>7</vTx><vTxDoubleScale>10</vTxDoubleScale></kp>
        </Params>
        <SerOrder><ser>kp</ser></SerOrder>
      </ConfigParams>
      """
    XCTAssertThrowsError(try RefloatConfigSchemaParser.parse(Array(duplicateInParams.utf8))) { error in
      XCTAssertEqual((error as? RefloatConfigSchemaException)?.code, .duplicateFieldId)
    }

    let duplicateInSerOrder = """
      <ConfigParams>
        <Params>
          <kp><type>1</type><vTx>7</vTx><vTxDoubleScale>10</vTxDoubleScale></kp>
        </Params>
        <SerOrder><ser>kp</ser><ser>kp</ser></SerOrder>
      </ConfigParams>
      """
    XCTAssertThrowsError(try RefloatConfigSchemaParser.parse(Array(duplicateInSerOrder.utf8))) { error in
      XCTAssertEqual((error as? RefloatConfigSchemaException)?.code, .duplicateFieldId)
    }

    let duplicateLegacy = """
      <CustomConfiguration><params>
        <param name="kp" type="float" />
        <param name="kp" type="float" />
      </params></CustomConfiguration>
      """
    XCTAssertThrowsError(try RefloatConfigSchemaParser.parse(Array(duplicateLegacy.utf8))) { error in
      XCTAssertEqual((error as? RefloatConfigSchemaException)?.code, .duplicateFieldId)
    }
  }

  func testMapsTypes456WithCorrectSignednessAndSizeAndRoundTrips() throws {
    let xml = """
      <ConfigParams>
        <Params>
          <mode>
            <type>4</type>
            <longName>Mode</longName>
            <valInt>2</valInt>
            <enumNames>Off</enumNames>
            <enumNames>Low</enumNames>
            <enumNames>High</enumNames>
          </mode>
          <enabled>
            <type>5</type>
            <longName>Enabled</longName>
            <valInt>1</valInt>
          </enabled>
          <flags>
            <type>6</type>
            <longName>Flags</longName>
            <valInt>200</valInt>
          </flags>
          <config_name>
            <type>3</type>
            <longName>Config Name</longName>
            <valString>RefloatConfig</valString>
          </config_name>
        </Params>
        <SerOrder>
          <ser>mode</ser>
          <ser>enabled</ser>
          <ser>flags</ser>
        </SerOrder>
        <Grouping>
          <group>
            <groupName>General</groupName>
            <subgroup>
              <subgroupName>Basics</subgroupName>
              <subgroupParams>
                <param>::sep::Controls</param>
                <param>mode</param>
                <param>enabled</param>
                <param>flags</param>
                <param>config_name</param>
              </subgroupParams>
            </subgroup>
          </group>
        </Grouping>
      </ConfigParams>
      """

    let schema = try RefloatConfigSchemaParser.parse(Array(xml.utf8))
    XCTAssertEqual(schema.fields.map(\.id), ["mode", "enabled", "flags"])
    XCTAssertEqual(schema.fields[0].type, .uint8)
    XCTAssertEqual(schema.fields[0].enumNames, ["Off", "Low", "High"])
    XCTAssertEqual(schema.fields[0].defaultValue, .number(2))
    XCTAssertEqual(schema.fields[1].type, .bool)
    XCTAssertEqual(schema.fields[1].defaultValue, .bool(true))
    XCTAssertEqual(schema.fields[2].type, .uint8)
    XCTAssertEqual(schema.fields[2].defaultValue, .number(200))
    XCTAssertEqual(schema.fields.map(\.offset), [0, 1, 2])

    let decoded = RefloatConfigDecoder.decodeFieldMap(schema: schema, rawConfig: [200, 1, 255])
    XCTAssertEqual(decoded["mode"] as? Double, 200)
    XCTAssertEqual(decoded["enabled"] as? Bool, true)
    XCTAssertEqual(decoded["flags"] as? Double, 255)

    let encoded = try RefloatConfigEncoder.encode(
      schema: schema,
      rawConfig: [0, 0, 0],
      fields: ["mode": 2.0, "enabled": true, "flags": 255.0]
    )
    XCTAssertEqual(encoded, [2, 1, 255])

    let items = schema.groups.first?.subgroups.first?.items
    XCTAssertEqual(items, [.separator("Controls"), .field("mode"), .field("enabled"), .field("flags")])
  }

  func testParsesRefloat121And130FixturesWithFullMetadataAndGrouping() throws {
    let s121 = try parseFixture("1.2.1")
    XCTAssertEqual(s121.hash, "9b8979a36759810a7fa9c19d01534ed52ec9ed8ac4a2d3ab3aefc594ba3b93cc")
    XCTAssertEqual(s121.fields.count, 167)
    XCTAssertEqual(s121.fields.map { $0.offset + $0.type.byteSize }.max(), 272)
    XCTAssertTrue(s121.rawXml.hasPrefix("<?xml"))

    let s130 = try parseFixture("1.3.0")
    XCTAssertEqual(s130.hash, "62681208dc609eb19420c89df65105f018499aa9f5741f295f00d62ea5a1bceb")
    XCTAssertEqual(s130.fields.count, 172)
    XCTAssertEqual(s130.fields.map { $0.offset + $0.type.byteSize }.max(), 278)

    for schema in [s121, s130] {
      let byId = Dictionary(uniqueKeysWithValues: schema.fields.map { ($0.id, $0) })
      XCTAssertNil(byId["config_name"])
      XCTAssertNil(byId["hw_name"])

      let kp = try XCTUnwrap(byId["kp"])
      XCTAssertEqual(kp.type, .float16Scaled)
      XCTAssertEqual(kp.xmlType, 1)
      XCTAssertEqual(kp.vTx, 7)
      XCTAssertEqual(kp.scale, 10)
      XCTAssertEqual(kp.min, 0)
      XCTAssertEqual(kp.max, 40)
      XCTAssertEqual(kp.step, 1)
      XCTAssertEqual(kp.editorDecimals, 1)
      XCTAssertEqual(kp.editorScale, 1)
      XCTAssertFalse(kp.editAsPercentage)
      XCTAssertEqual(kp.defaultValue, .number(20))
      XCTAssertTrue(kp.transmittable)
      XCTAssertFalse(kp.showDisplay)
      XCTAssertEqual(kp.label, "Angle P")
      XCTAssertEqual(kp.cDefine, "CFG_DFLT_KP")
      let desc = try XCTUnwrap(kp.description)
      XCTAssertTrue(desc.hasPrefix("Angle P (Proportional)"))
      XCTAssertFalse(desc.contains("<html"))
      XCTAssertFalse(desc.contains("&gt;"))

      let duty = try XCTUnwrap(byId["tiltback_duty"])
      XCTAssertTrue(duty.editAsPercentage)
      XCTAssertEqual(duty.editorDecimals, 2)
      XCTAssertEqual(duty.step, 0.01)
      XCTAssertEqual(duty.defaultValue, .number(0.8))

      let remoteType = try XCTUnwrap(byId["inputtilt_remote_type"])
      XCTAssertEqual(remoteType.type, .uint8)
      XCTAssertEqual(remoteType.xmlType, 4)
      XCTAssertNil(remoteType.vTx)
      XCTAssertEqual(remoteType.enumNames, ["None", "UART", "PPM"])
      XCTAssertEqual(remoteType.defaultValue, .number(0))

      let ledsOn = try XCTUnwrap(byId["leds.on"])
      XCTAssertEqual(ledsOn.type, .bool)
      XCTAssertEqual(ledsOn.xmlType, 5)
      XCTAssertEqual(ledsOn.defaultValue, .bool(true))

      let halfErpm = try XCTUnwrap(byId["fault_adc_half_erpm"])
      XCTAssertEqual(halfErpm.type, .uint16)
      XCTAssertEqual(halfErpm.unit, "ERPM")
      XCTAssertEqual(halfErpm.step, 50)
      XCTAssertEqual(halfErpm.defaultValue, .number(200))

      XCTAssertEqual(schema.groups.map(\.name), ["General", "Internal"])
      XCTAssertEqual(
        schema.groups[0].subgroups.map(\.name),
        [
          "Tune", "Tune Modifiers", "ATR", "Startup", "Stop",
          "Pushback Alerts", "Haptic Feedback", "Remote", "LEDs", "Specs", "BMS",
        ]
      )
      XCTAssertEqual(schema.groups[1].subgroups.map(\.name), ["Meta"])
      XCTAssertEqual(schema.groups[0].subgroups[0].items[0], .separator("PID"))
      XCTAssertEqual(schema.groups[0].subgroups[0].items[1], .field("kp"))
      XCTAssertNotNil(schema.toBridgeMap()["fields"])
    }
  }
}
