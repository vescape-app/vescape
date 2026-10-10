import XCTest
@testable import VescapeCore

final class VescProtocolTests: XCTestCase {
  func testBuildsRemoteTiltChuckCommand() {
    XCTAssertEqual(
      [UInt8(COMM_SET_CHUCK_DATA), 0, 127],
      buildRemoteTiltCommand(transport: .direct, value: 128)
    )
  }

  func testFramesRemoteTiltChuckForCan() {
    XCTAssertEqual(
      [UInt8(COMM_FORWARD_CAN), 7, UInt8(COMM_SET_CHUCK_DATA), 0, 0],
      buildRemoteTiltCommand(transport: .can(7), value: 255)
    )
  }

  func testBuildsBoardMoveRemoteCommandForRefloat13() {
    XCTAssertEqual(
      [UInt8(COMM_CUSTOM_APP_DATA), 101, 15, UInt8(bitPattern: -25)],
      buildBoardMoveCommand(transport: .direct, generation: .remote, input: -25)
    )
  }

  func testFramesBoardMoveForCan() {
    XCTAssertEqual(
      [UInt8(COMM_FORWARD_CAN), 7, UInt8(COMM_CUSTOM_APP_DATA), 101, 15, 0],
      buildBoardMoveCommand(transport: .can(7), generation: .remote, input: 0)
    )
  }

  func testBuildsBoardMoveRcMoveCommandForOlderRefloat() {
    // [CUSTOM_APP_DATA, magic, RC_MOVE, direction, current, time, current + time]. `time` runs the
    // request for `time * 100` control-loop steps (~120 ms each), so it must outlive the repeat tick.
    XCTAssertEqual(
      [UInt8(COMM_CUSTOM_APP_DATA), 101, 7, 1, 60, 8, 68],
      buildBoardMoveCommand(transport: .direct, generation: .rcMove, input: 127)
    )
    XCTAssertEqual(
      [UInt8(COMM_CUSTOM_APP_DATA), 101, 7, 1, 0, 1, 1],
      buildBoardMoveCommand(transport: .direct, generation: .rcMove, input: 0)
    )
  }

  func testBoardMoveGenerationFollowsTheRefloatBaseVersion() {
    XCTAssertEqual(.rcMove, BoardMoveGeneration.forBaseVersion("1.2.0"))
    XCTAssertEqual(.rcMove, BoardMoveGeneration.forBaseVersion("1.0.0"))
    XCTAssertEqual(.remote, BoardMoveGeneration.forBaseVersion("1.3.0"))
    XCTAssertEqual(.remote, BoardMoveGeneration.forBaseVersion("2.0.0"))
    // Unknown firmware guesses the current generation rather than refusing to move.
    XCTAssertEqual(.remote, BoardMoveGeneration.forBaseVersion(nil))
    XCTAssertEqual(.remote, BoardMoveGeneration.forBaseVersion("nonsense"))
  }

  func testParsesFirmwareVersionPayloads() {
    XCTAssertNil(parseFwVersion(payload: [UInt8(COMM_FW_VERSION), 6]))
    XCTAssertEqual("FW 6.05", parseFwVersion(payload: [UInt8(COMM_FW_VERSION), 6, 5]))
    XCTAssertEqual(
      "FW 6.05 · VESC Express · Refloat, Float Package",
      parseFwVersion(payload: fwVersionPayload("VESC Express", "Refloat", "Float Package"))
    )
  }

  func testToleratesTruncatedFirmwareCustomConfigTail() {
    let payload = Array(fwVersionPayload("VESC", "Refloat").prefix(3 + 4 + 1 + 15 + 1 + 4))

    XCTAssertEqual("FW 6.05 · VESC · Refl", parseFwVersion(payload: payload))
  }

  func testBuildsLightsControlCommandForBothSwitches() {
    // mask uint32 BE = 3 (lights + headlights), value = 3 (both on).
    XCTAssertEqual(
      [UInt8(COMM_CUSTOM_APP_DATA), 101, 20, 0, 0, 0, 3, 3],
      buildLightsControlCommand(
        transport: .direct, generation: .current, enabled: true, headlightsEnabled: true)
    )
    // The mask still names both switches when turning them off, so the value clears both.
    XCTAssertEqual(
      [UInt8(COMM_FORWARD_CAN), 7, UInt8(COMM_CUSTOM_APP_DATA), 101, 20, 0, 0, 0, 3, 0],
      buildLightsControlCommand(
        transport: .can(7), generation: .current, enabled: false, headlightsEnabled: false)
    )
    // The two switches are independent: the mask names both, the value states each one.
    XCTAssertEqual(
      [UInt8(COMM_CUSTOM_APP_DATA), 101, 20, 0, 0, 0, 3, 1],
      buildLightsControlCommand(
        transport: .direct, generation: .current, enabled: true, headlightsEnabled: false)
    )
    XCTAssertEqual(
      [UInt8(COMM_CUSTOM_APP_DATA), 101, 20, 0, 0, 0, 3, 2],
      buildLightsControlCommand(
        transport: .direct, generation: .current, enabled: false, headlightsEnabled: true)
    )
  }

  func testBuildsLegacyLightsControlCommandForRefloat11() {
    // Refloat 1.1 and older: command 202 and a single mask byte, not the uint32 of 1.2+.
    XCTAssertEqual(
      [UInt8(COMM_CUSTOM_APP_DATA), 101, 202, 3, 3],
      buildLightsControlCommand(
        transport: .direct, generation: .legacy, enabled: true, headlightsEnabled: true)
    )
    XCTAssertEqual(
      [UInt8(COMM_FORWARD_CAN), 7, UInt8(COMM_CUSTOM_APP_DATA), 101, 202, 3, 0],
      buildLightsControlCommand(
        transport: .can(7), generation: .legacy, enabled: false, headlightsEnabled: false)
    )
  }

  func testResolvesLightsGenerationAtTheRefloat12Boundary() {
    // 1.2.0 is where the command moved out of the unstable 200+ range.
    XCTAssertEqual(.legacy, BoardLightsGeneration.forBaseVersion("1.1.2"))
    XCTAssertEqual(.current, BoardLightsGeneration.forBaseVersion("1.2.0"))
    XCTAssertEqual(.current, BoardLightsGeneration.forBaseVersion("2.0.0"))
    // An unreadable version guesses current: the board ignores a command it does not know.
    XCTAssertEqual(.current, BoardLightsGeneration.forBaseVersion(nil))
  }

  func testParsesLightsControlEcho() {
    XCTAssertEqual(
      BoardLightsState(enabled: true, headlightsEnabled: true),
      parseLightsControlResponse([UInt8(COMM_CUSTOM_APP_DATA), 101, 20, 3])
    )
    XCTAssertEqual(
      BoardLightsState(enabled: true, headlightsEnabled: false),
      parseLightsControlResponse([UInt8(COMM_FORWARD_CAN), 7, UInt8(COMM_CUSTOM_APP_DATA), 101, 20, 1])
    )
    // Both bits are read independently: headlights on, lights off.
    XCTAssertEqual(
      BoardLightsState(enabled: false, headlightsEnabled: true),
      parseLightsControlResponse([UInt8(COMM_CUSTOM_APP_DATA), 101, 20, 2])
    )
    // A telemetry frame must never be mistaken for the lights echo — this interception sits in front
    // of the telemetry parser, in both the direct and the CAN-forwarded form.
    XCTAssertNil(parseLightsControlResponse([UInt8(COMM_CUSTOM_APP_DATA), 101, 10, 2]))
    XCTAssertNil(parseLightsControlResponse([UInt8(COMM_FORWARD_CAN), 7, UInt8(COMM_CUSTOM_APP_DATA), 101, 10, 2]))
    // The legacy echo carries the same status byte under command 202.
    XCTAssertEqual(
      BoardLightsState(enabled: true, headlightsEnabled: true),
      parseLightsControlResponse([UInt8(COMM_CUSTOM_APP_DATA), 101, 202, 3])
    )
    // A truncated echo has no state byte to read.
    XCTAssertNil(parseLightsControlResponse([UInt8(COMM_CUSTOM_APP_DATA), 101, 20]))
  }

  func testBuildsShortPacketWithCrc() {
    let payload = [UInt8(COMM_CUSTOM_APP_DATA), UInt8(REFLOAT_MAGIC), UInt8(REFLOAT_GET_ALLDATA), 2]

    XCTAssertEqual(
      [0x02, 0x04, 0x24, 0x65, 0x0a, 0x02, 0x42, 0xad, 0x03],
      VescPacketCodec.buildPacket(payload)
    )
  }

  func testBuildsLongPacketWithCrc() {
    let payload = Array(repeating: UInt8(COMM_PING_CAN), count: 300)
    let frame = VescPacketCodec.buildPacket(payload)

    XCTAssertEqual(0x03, frame[0])
    XCTAssertEqual(0x01, frame[1])
    XCTAssertEqual(0x2c, frame[2])
    XCTAssertEqual(306, frame.count)
    XCTAssertEqual(0x37, frame[303])
    XCTAssertEqual(0x34, frame[304])
    XCTAssertEqual(0x03, frame[305])
  }

  func testCodecRoundTripsSplitFrameThroughReassembler() {
    let payload = [UInt8(COMM_CUSTOM_APP_DATA), UInt8(REFLOAT_MAGIC), UInt8(REFLOAT_GET_ALLDATA), 2]
    let frame = VescPacketCodec.encode(payload)
    let reassembler = VescPacketReassembler()

    XCTAssertTrue(reassembler.feed(Array(frame.prefix(3))).isEmpty)
    let packets = reassembler.feed(Array(frame.dropFirst(3)))

    XCTAssertEqual(1, packets.count)
    XCTAssertEqual(payload, packets.first)
  }

  func testReassemblerDropsNoiseAndBadCrcBeforeValidPacket() {
    let payload = [UInt8(COMM_PING_CAN)]
    let valid = VescPacketCodec.buildPacket(payload)
    let corrupted = [UInt8](valid.dropLast()) + [0x00]
    let reassembler = VescPacketReassembler()

    let packets = reassembler.feed([0xff, 0x00] + corrupted + valid)

    XCTAssertEqual([payload], packets)
  }

  func testCommandConstantsAndNusUuidsMatchAndroidProtocol() {
    XCTAssertEqual(0, COMM_FW_VERSION)
    XCTAssertEqual(34, COMM_FORWARD_CAN)
    XCTAssertEqual(36, COMM_CUSTOM_APP_DATA)
    XCTAssertEqual(62, COMM_PING_CAN)
    XCTAssertEqual(96, COMM_BMS_GET_VALUES)
    XCTAssertEqual("6E400001-B5A3-F393-E0A9-E50E24DCCA9E", VescUartUUIDs.service.uuidString)
    XCTAssertEqual("6E400002-B5A3-F393-E0A9-E50E24DCCA9E", VescUartUUIDs.tx.uuidString)
    XCTAssertEqual("6E400003-B5A3-F393-E0A9-E50E24DCCA9E", VescUartUUIDs.rx.uuidString)
  }

  func testParsesBmsCellVoltagesBalancingAndSoc() {
    var payload = [UInt8](repeating: 0, count: 45)
    payload[0] = UInt8(COMM_BMS_GET_VALUES)
    putInt32(&payload, 1, 60_000_000) // v_tot 60.0V (scale 1e6)
    putInt32(&payload, 5, 54_000_000) // v_charge 54.0V (scale 1e6)
    putInt32(&payload, 9, 5_000_000) // i_in 5.0A (scale 1e6)
    putInt32(&payload, 13, -2_000_000) // i_in_ic -2.0A (scale 1e6)
    payload[25] = 3 // cell_num
    putInt16(&payload, 26, 3650) // 3.650V
    putInt16(&payload, 28, 3700) // 3.700V
    putInt16(&payload, 30, 3680) // 3.680V
    payload[32] = 0 // balancing cell 0
    payload[33] = 1 // balancing cell 1
    payload[34] = 0 // balancing cell 2
    payload[35] = 0 // temp_adc_num
    payload[44] = 216 // soc ≈ 0.847

    let bms = parseBmsValues(payload, packetAt: 555)!

    XCTAssertEqual(555, bms.capturedAt)
    XCTAssertEqual(60.0, bms.voltageTotal, accuracy: 0.001)
    XCTAssertEqual(54.0, bms.vCharge, accuracy: 0.001)
    XCTAssertEqual(5.0, bms.current, accuracy: 0.001)
    XCTAssertEqual(-2.0, bms.currentIc, accuracy: 0.001)
    XCTAssertEqual([3.65, 3.70, 3.68], bms.cellVoltages.map { ($0 * 1000).rounded() / 1000.0 })
    XCTAssertEqual([false, true, false], bms.balancing)
    XCTAssertEqual(216.0 / 255.0, bms.soc!, accuracy: 0.001)
  }

  func testParsesBmsTemperaturesSohAndCanId() {
    // id + 6 float32 (25) + cell_num + 2 cells + 2 bal + temp_adc_num + 2 temps
    // + temp_ic/hum/hum/max_cell (8) + soc + soh + can_id = 48 bytes.
    var payload = [UInt8](repeating: 0, count: 48)
    payload[0] = UInt8(COMM_BMS_GET_VALUES)
    payload[25] = 2 // cell_num
    putInt16(&payload, 26, 4100)
    putInt16(&payload, 28, 4050)
    payload[32] = 2 // temp_adc_num
    putInt16(&payload, 33, 2530) // temps[0] 25.30°C (scale 1e2)
    putInt16(&payload, 35, -500) // temps[1] -5.00°C
    putInt16(&payload, 37, 4200) // temp_ic 42.0°C
    putInt16(&payload, 39, 2600) // temp_hum 26.0°C
    putInt16(&payload, 41, 5500) // hum 55.0%
    putInt16(&payload, 43, 4300) // temp_max_cell 43.0°C
    payload[45] = 216 // soc ≈ 0.847
    payload[46] = 240 // soh ≈ 0.941
    payload[47] = 10 // can_id

    let bms = parseBmsValues(payload, packetAt: 7)!

    XCTAssertEqual([25.30, -5.00], bms.temps.map { ($0 * 100).rounded() / 100.0 })
    XCTAssertEqual(42.0, bms.tempIc!, accuracy: 0.001)
    XCTAssertEqual(26.0, bms.tempHum!, accuracy: 0.001)
    XCTAssertEqual(55.0, bms.humidity!, accuracy: 0.001)
    XCTAssertEqual(43.0, bms.tempMaxCell!, accuracy: 0.001)
    XCTAssertEqual(216.0 / 255.0, bms.soc!, accuracy: 0.001)
    XCTAssertEqual(240.0 / 255.0, bms.soh!, accuracy: 0.001)
    XCTAssertEqual(10, bms.canId)
  }

  func testParsesBmsWithoutTrailingFields() {
    // id + 6 float32 + cell_num + 2 cells, nothing after.
    var payload = [UInt8](repeating: 0, count: 30)
    payload[0] = UInt8(COMM_BMS_GET_VALUES)
    payload[25] = 2
    putInt16(&payload, 26, 4100)
    putInt16(&payload, 28, 4050)

    let bms = parseBmsValues(payload, packetAt: 1)!

    XCTAssertEqual(2, bms.cellVoltages.count)
    XCTAssertEqual(4.1, bms.cellVoltages[0], accuracy: 0.001)
    XCTAssertEqual([false, false], bms.balancing)
    XCTAssertNil(bms.soc)
  }

  func testDecodesNegativeBmsCurrent() {
    var payload = [UInt8](repeating: 0, count: 30)
    payload[0] = UInt8(COMM_BMS_GET_VALUES)
    putInt32(&payload, 9, -3_000_000) // i_in -3.0A while discharging
    payload[25] = 1
    putInt16(&payload, 26, 3900)

    XCTAssertEqual(-3.0, parseBmsValues(payload, packetAt: 1)!.current, accuracy: 0.001)
  }

  func testRejectsNonBmsOrTruncatedPayloads() {
    XCTAssertNil(parseBmsValues([UInt8(COMM_FW_VERSION)], packetAt: 1))
    var tooShort = [UInt8](repeating: 0, count: 26)
    tooShort[0] = UInt8(COMM_BMS_GET_VALUES)
    tooShort[25] = 5 // claims 5 cells but no cell bytes follow
    XCTAssertNil(parseBmsValues(tooShort, packetAt: 1))
  }

  private func putInt16(_ bytes: inout [UInt8], _ offset: Int, _ value: Int) {
    let raw = UInt16(bitPattern: Int16(value))
    bytes[offset] = UInt8((raw >> 8) & 0xff)
    bytes[offset + 1] = UInt8(raw & 0xff)
  }

  private func putInt32(_ bytes: inout [UInt8], _ offset: Int, _ value: Int) {
    let raw = UInt32(bitPattern: Int32(value))
    bytes[offset] = UInt8((raw >> 24) & 0xff)
    bytes[offset + 1] = UInt8((raw >> 16) & 0xff)
    bytes[offset + 2] = UInt8((raw >> 8) & 0xff)
    bytes[offset + 3] = UInt8(raw & 0xff)
  }

  private func fwVersionPayload(_ hardwareName: String, _ customConfigs: String...) -> [UInt8] {
    var bytes: [UInt8] = [UInt8(COMM_FW_VERSION), 6, 5]
    bytes.append(contentsOf: hardwareName.utf8)
    bytes.append(0)
    bytes.append(contentsOf: Array(repeating: 0, count: 15))
    bytes.append(UInt8(customConfigs.count))
    for config in customConfigs {
      bytes.append(contentsOf: config.utf8)
      bytes.append(0)
    }
    return bytes
  }
}
