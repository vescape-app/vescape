import XCTest
@testable import VescapeCore

final class RefloatConfigSchemaTests: XCTestCase {
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
}
