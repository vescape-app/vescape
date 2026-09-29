import CoreBluetooth

/// The peripheral operations used by the transport. CBMutableService/Characteristic remain the
/// real GATT model; tests can drive the same handlers without constructing an Apple-owned peripheral.
internal protocol VescPeripheral: AnyObject {
  var identifier: UUID { get }
  var name: String? { get }
  var state: CBPeripheralState { get }
  var delegate: CBPeripheralDelegate? { get set }
  var services: [CBService]? { get }
  var canSendWriteWithoutResponse: Bool { get }
  func discoverServices(_ serviceUUIDs: [CBUUID]?)
  func discoverCharacteristics(_ characteristicUUIDs: [CBUUID]?, for service: CBService)
  func setNotifyValue(_ enabled: Bool, for characteristic: CBCharacteristic)
  func writeValue(_ data: Data, for characteristic: CBCharacteristic, type: CBCharacteristicWriteType)
}

extension CBPeripheral: VescPeripheral {}

/// CoreBluetooth operations used by the board transport. Keeps scan/recovery tests on the real
/// VescGattClient while replacing only the system radio; production uses CBCentralManager.
internal protocol VescCentralManager: AnyObject {
  var state: CBManagerState { get }
  func knownPeripherals(_ identifiers: [UUID]) -> [VescPeripheral]
  func connectedPeripherals(_ serviceUUIDs: [CBUUID]) -> [VescPeripheral]
  func connect(_ peripheral: VescPeripheral, options: [String: Any]?)
  func cancelPeripheralConnection(_ peripheral: VescPeripheral)
  func scanForPeripherals(withServices serviceUUIDs: [CBUUID]?, options: [String: Any]?)
  func stopScan()
}

extension CBCentralManager: VescCentralManager {
  func knownPeripherals(_ identifiers: [UUID]) -> [VescPeripheral] {
    retrievePeripherals(withIdentifiers: identifiers)
  }

  func connectedPeripherals(_ serviceUUIDs: [CBUUID]) -> [VescPeripheral] {
    retrieveConnectedPeripherals(withServices: serviceUUIDs)
  }

  func connect(_ peripheral: VescPeripheral, options: [String: Any]?) {
    guard let peripheral = peripheral as? CBPeripheral else {
      preconditionFailure("A system central requires a system peripheral")
    }
    connect(peripheral, options: options)
  }

  func cancelPeripheralConnection(_ peripheral: VescPeripheral) {
    guard let peripheral = peripheral as? CBPeripheral else {
      preconditionFailure("A system central requires a system peripheral")
    }
    cancelPeripheralConnection(peripheral)
  }
}
