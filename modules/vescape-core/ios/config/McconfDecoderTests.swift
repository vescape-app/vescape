import XCTest

/// The fixture is the real head of a `COMM_GET_MCCONF` response captured from a Thor301 on
/// 2026-08-24, and the expected values are what VESC Tool showed for that board at the same moment.
/// It is the only check that the generated offsets describe an actual blob rather than our reading of
/// firmware source.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/config/McconfDecoderTest.kt
final class McconfDecoderTests: XCTestCase {
  private let boardHead = hexToBytes(
    "3f829cf70100020043200000c3200000428c0000c23400002710003243700000c68ca000468ca000"
      + "1f404396000044bb8000017c03ca021c01f403e8044c004650505a0000003225"
  )

  func testRealBoardBlobDecodesToTheValuesVescToolShowed() {
    // The capture is only the head of the blob, so pad it out to the length 6.05 declares.
    var padded = boardHead
    padded.append(contentsOf: [UInt8](repeating: 0, count: 477 - padded.count))

    guard case let .decoded(signature, firmware, values) = McconfDecoder.decode(padded) else {
      return XCTFail("expected a decode, got \(McconfDecoder.decode(padded))")
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
    guard case .malformed = McconfDecoder.decode(Array(boardHead.prefix(120))) else {
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
