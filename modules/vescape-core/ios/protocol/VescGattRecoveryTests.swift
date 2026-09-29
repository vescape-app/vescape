import CoreBluetooth
import XCTest
@testable import VescapeCore

/// Exercises the production transport, including scan ownership, with only CoreBluetooth replaced.
final class VescGattRecoveryTests: XCTestCase {
  private let target = UUID(uuidString: "2AA724EF-104A-479A-A36F-004910FBD290")!

  func testRestartRejectsCancelledLinksCallbacksWhenPeripheralObjectIsReused() {
    let fixture = ConnectedGattFixture(target: target)
    fixture.subscribe()
    fixture.gatt.connect(peripheralId: target.uuidString)
    XCTAssertEqual(fixture.central.cancelCount, 1)
    fixture.gatt.didUpdateNotificationState(fixture.peripheral, characteristic: fixture.peripheral.rx, error: nil)
    fixture.gatt.didDiscoverServices(fixture.peripheral, error: nil)
    fixture.peripheral.rx.value = Data([1, 2, 3])
    fixture.gatt.didUpdateValue(fixture.peripheral, characteristic: fixture.peripheral.rx, error: nil)
    fixture.scheduler.advance(1_000)
    XCTAssertEqual(fixture.listener.readyCount, 0)
    XCTAssertEqual(fixture.listener.subscribingCount, 1)
    XCTAssertEqual(fixture.listener.frameCount, 0)
    fixture.gatt.didDisconnect(fixture.peripheral, error: nil)
    XCTAssertEqual(fixture.listener.disconnects, [true])
    fixture.subscribe()
    fixture.gatt.didUpdateNotificationState(fixture.peripheral, characteristic: fixture.peripheral.rx, error: nil)
    XCTAssertEqual(fixture.listener.connectedCount, 2)
    XCTAssertEqual(fixture.listener.readyCount, 1)
    fixture.scheduler.advance(1_000)
    XCTAssertEqual(fixture.listener.readyCount, 1)
    fixture.gatt.didDisconnect(fixture.peripheral, error: nil)
    XCTAssertEqual(fixture.listener.disconnects, [true, false])
  }

  func testNotificationAckBeforeSubscriptionCannotResolveReady() {
    let fixture = ConnectedGattFixture(target: target)
    fixture.gatt.didConnect(fixture.peripheral)
    fixture.gatt.didUpdateNotificationState(fixture.peripheral, characteristic: fixture.peripheral.rx, error: nil)
    XCTAssertEqual(fixture.listener.readyCount, 0)
  }

  func testReconnectDropsInterruptedWritesAndNotificationFallback() {
    let fixture = ConnectedGattFixture(target: target)
    fixture.subscribe()
    fixture.gatt.didUpdateNotificationState(fixture.peripheral, characteristic: fixture.peripheral.rx, error: nil)
    XCTAssertTrue(fixture.gatt.sendPayload([1]))
    XCTAssertTrue(fixture.gatt.sendPayload([2]))
    XCTAssertEqual(fixture.peripheral.writes.count, 1)
    fixture.gatt.didDisconnect(fixture.peripheral, error: nil)
    fixture.gatt.reconnect()
    fixture.scheduler.advance(1_000)
    XCTAssertEqual(fixture.listener.readyCount, 1)
    fixture.subscribe()
    fixture.gatt.didUpdateNotificationState(fixture.peripheral, characteristic: fixture.peripheral.rx, error: nil)
    XCTAssertTrue(fixture.gatt.sendPayload([3]))
    XCTAssertEqual(fixture.peripheral.writes, [Data(VescPacketCodec.encode([1])), Data(VescPacketCodec.encode([3]))])
  }

  func testCentralIsCreatedAtConstructionBeforeAnyConnectOrScan() {
    let central = RecoveryTestCentral()
    let listener = RecoveryTestGattListener()
    var constructions = 0
    let gatt = VescGattClient(listener: listener, centralFactory: {
      constructions += 1
      return central
    })
    XCTAssertEqual(constructions, 1, "Launch-time construction must start CoreBluetooth restoration")
    gatt.startScan()
    XCTAssertEqual(constructions, 1)
    gatt.stopScan()
  }

  func testFreshRetryWithoutRetainedPeripheralKeepsSearchingAcrossScanWindows() {
    let central = RecoveryTestCentral()
    let listener = RecoveryTestGattListener()
    let gatt = VescGattClient(listener: listener, centralFactory: { central })
    gatt.connect(peripheralId: target.uuidString)
    // The connect watchdog starts a fresh attempt through connect(), not reconnect().
    gatt.connect(peripheralId: target.uuidString)
    for _ in 0..<3 {
      gatt.startReconnectScan()
      gatt.stopReconnectScan()
      XCTAssertTrue(central.scanning, "Required target scan must survive supplemental idle gaps")
    }
    XCTAssertEqual(central.requestedIdentifiers.last, [target])
    gatt.disconnect()
    XCTAssertFalse(central.scanning)
  }

  func testDeferredRetryKeepsSearchingAfterBluetoothReturns() {
    let central = RecoveryTestCentral()
    central.state = .poweredOff
    let listener = RecoveryTestGattListener()
    let gatt = VescGattClient(listener: listener, centralFactory: { central })
    gatt.connect(peripheralId: target.uuidString)
    XCTAssertFalse(central.scanning)
    central.state = .poweredOn
    gatt.centralStateDidChange(.poweredOn)
    gatt.startReconnectScan()
    gatt.stopReconnectScan()
    XCTAssertTrue(central.scanning)
    gatt.disconnect()
  }

  func testBluetoothReturnConnectsRetainedPeripheralBeforeReady() {
    let fixture = ConnectedGattFixture(target: target)
    fixture.subscribe()
    fixture.gatt.didUpdateNotificationState(fixture.peripheral, characteristic: fixture.peripheral.rx, error: nil)
    XCTAssertEqual(fixture.central.connectCount, 1)
    fixture.central.state = .poweredOff
    fixture.gatt.centralStateDidChange(.poweredOff)
    XCTAssertEqual(fixture.listener.failures, ["BLE_OFF"])
    // The controller's failure delay is covered separately; this exercises its transport intent.
    fixture.gatt.connect(peripheralId: target.uuidString)
    fixture.scheduler.advance(1_000)
    XCTAssertEqual(fixture.central.connectCount, 1)
    XCTAssertEqual(fixture.listener.readyCount, 1)
    fixture.central.state = .poweredOn
    fixture.gatt.centralStateDidChange(.poweredOn)
    XCTAssertEqual(fixture.central.connectCount, 2, "Power-on must issue a real central connect request")
    XCTAssertEqual(fixture.listener.readyCount, 1)
    fixture.subscribe()
    fixture.gatt.didUpdateNotificationState(fixture.peripheral, characteristic: fixture.peripheral.rx, error: nil)
    XCTAssertEqual(fixture.listener.readyCount, 2)
  }

  func testCancelWhileBluetoothOffCannotReviveDeferredConnect() {
    let central = RecoveryTestCentral()
    central.state = .poweredOff
    let listener = RecoveryTestGattListener()
    let gatt = VescGattClient(listener: listener, centralFactory: { central })
    gatt.connect(peripheralId: target.uuidString)
    gatt.disconnect()
    central.state = .poweredOn
    gatt.centralStateDidChange(.poweredOn)
    XCTAssertTrue(central.requestedIdentifiers.isEmpty)
    XCTAssertFalse(central.scanning)
  }

  func testDiscoveryScanAndTargetScanDoNotCancelEachOther() {
    let central = RecoveryTestCentral()
    let listener = RecoveryTestGattListener()
    let gatt = VescGattClient(listener: listener, centralFactory: { central })
    gatt.startScan()
    gatt.connect(peripheralId: target.uuidString)
    gatt.disconnect()
    XCTAssertTrue(central.scanning, "Disconnect must preserve the user's discovery scan")
    gatt.connect(peripheralId: target.uuidString)
    gatt.stopScan()
    XCTAssertTrue(central.scanning, "Stopping discovery must preserve the required target scan")
    gatt.stopReconnectScan()
    XCTAssertTrue(central.scanning)
    gatt.disconnect()
    XCTAssertFalse(central.scanning)
  }
}

private final class RecoveryTestCentral: VescCentralManager {
  var state: CBManagerState = .poweredOn
  var scanning = false
  var requestedIdentifiers: [[UUID]] = []
  var peripheral: VescPeripheral?
  var cancelCount = 0
  var connectCount = 0
  func knownPeripherals(_ identifiers: [UUID]) -> [VescPeripheral] {
    requestedIdentifiers.append(identifiers)
    return peripheral.map { [$0] } ?? []
  }
  func connectedPeripherals(_ serviceUUIDs: [CBUUID]) -> [VescPeripheral] { [] }
  func connect(_ peripheral: VescPeripheral, options: [String: Any]?) { connectCount += 1 }
  func cancelPeripheralConnection(_ peripheral: VescPeripheral) { cancelCount += 1 }
  func scanForPeripherals(withServices serviceUUIDs: [CBUUID]?, options: [String: Any]?) { scanning = true }
  func stopScan() { scanning = false }
}

private final class RecoveryTestGattListener: VescGattListener {
  var connectedCount = 0
  var subscribingCount = 0
  var readyCount = 0
  var frameCount = 0
  var disconnects: [Bool] = []
  var failures: [String] = []
  func onDeviceDiscovered(id: String, name: String, rssi: Int, serviceUUIDs: [String]) {}
  func onScanFailure(_ message: String) {}
  func onGattConnected() { connectedCount += 1 }
  func onGattSubscribing() { subscribingCount += 1 }
  func onGattReady() { readyCount += 1 }
  func onGattDisconnected(intentional: Bool, message: String) { disconnects.append(intentional) }
  func onGattFailure(code: String, message: String) { failures.append(code) }
  func onGattFrameChunk(_ chunk: [UInt8]) { frameCount += 1 }
  func onGattRestored(peripheralIds: [String]) {}
}

private final class RecoveryTestPeripheral: VescPeripheral {
  let identifier: UUID
  var name: String? = "Test Board"
  var state: CBPeripheralState = .connected
  weak var delegate: CBPeripheralDelegate?
  var canSendWriteWithoutResponse = true
  let service = CBMutableService(type: VescGattUUIDs.service, primary: true)
  let tx = CBMutableCharacteristic(type: VescGattUUIDs.tx, properties: [.write], value: nil, permissions: [.writeable])
  let rx = CBMutableCharacteristic(type: VescGattUUIDs.rx, properties: [.notify], value: nil, permissions: [.readable])
  var services: [CBService]? { [service] }
  var writes: [Data] = []
  init(identifier: UUID) {
    self.identifier = identifier
    service.characteristics = [tx, rx]
  }
  func discoverServices(_ serviceUUIDs: [CBUUID]?) {}
  func discoverCharacteristics(_ characteristicUUIDs: [CBUUID]?, for service: CBService) {}
  func setNotifyValue(_ enabled: Bool, for characteristic: CBCharacteristic) {}
  func writeValue(_ data: Data, for characteristic: CBCharacteristic, type: CBCharacteristicWriteType) { writes.append(data) }
}

private final class ConnectedGattFixture {
  let central = RecoveryTestCentral()
  let listener = RecoveryTestGattListener()
  let scheduler = TestScheduler()
  let peripheral: RecoveryTestPeripheral
  let gatt: VescGattClient
  init(target: UUID) {
    peripheral = RecoveryTestPeripheral(identifier: target)
    central.peripheral = peripheral
    let central = central
    gatt = VescGattClient(listener: listener, scheduler: scheduler, centralFactory: { central })
    gatt.connect(peripheralId: target.uuidString)
  }
  func subscribe() {
    gatt.didConnect(peripheral)
    gatt.didDiscoverServices(peripheral, error: nil)
    gatt.didDiscoverCharacteristics(peripheral, service: peripheral.service, error: nil)
  }
}
