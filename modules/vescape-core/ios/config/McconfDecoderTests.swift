import XCTest

/// The fixture is a complete `COMM_GET_MCCONF` response captured from a Thor301 on
/// 2026-08-24, and the expected values are what VESC Tool showed for that board at the same moment.
/// It is the only check that the generated offsets describe an actual blob rather than our reading of
/// firmware source.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/config/McconfDecoderTest.kt
final class McconfDecoderTests: XCTestCase {
  private let boardBlob = hexToBytes(
      "3f829cf70100020043200000c3200000428c0000c23400002710003243700000"
      + "c68ca000468ca0001f404396000044bb8000017c03ca021c01f403e8044c0046"
      + "50505a00000032251c49b71b00c9b71b00271027102710431600004489800041"
      + "200000026c1f40479c400044160000ff010302050604ff44fa00003e20c49c42"
      + "33999a46dac0003df5c28f004334000040e000000244fa000046ea600039244f"
      + "d63861a74f3d37e9103cf765fe490647003d4ccccdfc1842480000447a000027"
      + "10451c4000442f00000000038400c8000a0000000a00050000ff9cff8902ab44"
      + "6723ff437a000044e1000044fa00000000020000010a3103e8000200c8002800"
      + "3c012c00960000453b800000053a83126f010044fee3854500402944ff21ecff"
      + "f5001dffee0000000000000101457a00000042200000196401f400c80000053b"
      + "83126f3b83126f38d1b71707d0446100000146c35000003ccccccd0000000000"
      + "00000039b7803407d03f80000000000000000000643d4ccccd3b96bb99019000"
      + "00003200c83f0000000000200003e803e80672067201f4000000000010453b80"
      + "004708b80046c350004553400000003f1c28f603e800fa032d1e3f8000003e9c"
      + "ac08001440c000003f80000000002d41003200000b5409c4106810cc00"
  )

  func testRealBoardBlobDecodesToTheValuesVescToolShowed() {
    guard case let .decoded(signature, firmware, values) = McconfDecoder.decode(boardBlob) else {
      return XCTFail("expected a decode, got \(McconfDecoder.decode(boardBlob))")
    }
    XCTAssertEqual(signature, 1_065_524_471)
    XCTAssertEqual(firmware, "release_6_05")

    XCTAssertEqual(values["l_temp_fet_start"]!, 70.0, accuracy: 0.001)
    XCTAssertEqual(values["l_temp_fet_end"]!, 80.0, accuracy: 0.001)
    XCTAssertEqual(values["l_temp_motor_start"]!, 80.0, accuracy: 0.001)
    XCTAssertEqual(values["l_temp_motor_end"]!, 90.0, accuracy: 0.001)

    // float32_auto and scaled-int16 paths, which the temperature bytes alone would not exercise.
    XCTAssertEqual(values["l_current_max"]!, 160.0, accuracy: 0.001)
    XCTAssertEqual(values["l_current_min"]!, -160.0, accuracy: 0.001)
    XCTAssertEqual(values["l_in_current_max"]!, 70.0, accuracy: 0.001)
    XCTAssertEqual(values["l_abs_current_max"]!, 240.0, accuracy: 0.001)
    XCTAssertEqual(values["l_battery_cut_start"]!, 54.0, accuracy: 0.001)
    XCTAssertEqual(values["l_battery_cut_end"]!, 50.0, accuracy: 0.001)

    // Tail fields, which a misaligned layout would corrupt long before reaching them.
    XCTAssertEqual(values["m_encoder_counts"]!, 8192.0, accuracy: 0.001)
    XCTAssertEqual(values["m_fault_stop_time_ms"]!, 50.0, accuracy: 0.001)
    XCTAssertEqual(values["m_ntc_motor_beta"]!, 3380.0, accuracy: 0.001)
    XCTAssertEqual(values["si_motor_poles"]!, 30.0, accuracy: 0.001)
    XCTAssertEqual(values["si_wheel_diameter"]!, 0.306, accuracy: 0.001)
    XCTAssertEqual(values["si_battery_cells"]!, 20.0, accuracy: 0.001)
    XCTAssertEqual(values["bms.t_limit_start"]!, 45.0, accuracy: 0.001)
    XCTAssertEqual(values["bms.vmin_limit_start"]!, 2.9, accuracy: 0.001)
  }

  func testUnknownSignatureDecodesNothingRatherThanGuessing() {
    var blob = [UInt8](repeating: 0, count: 477)
    blob[0] = 0xDE
    blob[1] = 0xAD
    blob[2] = 0xBE
    blob[3] = 0xEF

    guard case let .unknownSignature(signature, _) = McconfDecoder.decode(blob) else {
      return XCTFail("expected unknownSignature, got \(McconfDecoder.decode(blob))")
    }
    XCTAssertEqual(signature, 0xDEAD_BEEF)
  }

  func testBlobShorterThanItsLayoutIsMalformedNotPartiallyDecoded() {
    guard case .malformed = McconfDecoder.decode(Array(boardBlob.prefix(120))) else {
      return XCTFail("expected malformed")
    }
  }

  func testEveryLayoutHasAscendingOffsetsThatFitItsDeclaredLength() {
    for (signature, layout) in McconfLayouts.bySignature {
      XCTAssertEqual(signature, layout.signature)
      var expected = 4  // the signature itself is not a field
      for field in layout.fields {
        XCTAssertEqual(field.offset, expected, "\(layout.firmware) \(field.id)")
        expected += field.type.byteSize
      }
      XCTAssertEqual(layout.totalBytes, expected, layout.firmware)
    }
  }
}

private func hexToBytes(_ hex: String) -> [UInt8] {
  var bytes: [UInt8] = []
  var index = hex.startIndex
  while index < hex.endIndex {
    let next = hex.index(index, offsetBy: 2)
    bytes.append(UInt8(hex[index..<next], radix: 16)!)
    index = next
  }
  return bytes
}
