import CoreBluetooth
import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescGattClient.kt
internal protocol VescGattListener: AnyObject {
  func onDeviceDiscovered(id: String, name: String, rssi: Int, serviceUUIDs: [String])
  func onScanFailure(_ message: String)
  func onGattConnected()
  func onGattSubscribing()
  func onGattReady()
  func onGattDisconnected(intentional: Bool, message: String)
  func onGattFailure(code: String, message: String)
  func onGattFrameChunk(_ chunk: [UInt8])
  /// @platform-diff No Android peer: its `CoreForegroundService` keeps the process alive, so there
  func onGattRestored(peripheralIds: [String])
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescGattClient.kt `SessionTransport`
internal protocol SessionTransport: AnyObject {
  func connect(peripheralId: String)
  func disconnect()
  func reconnect()
  func startReconnectScan()
  func stopReconnectScan()
  @discardableResult
  func sendPayload(_ payload: [UInt8]) -> Bool
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescGattClient.kt `sendRemoteInput`
  @discardableResult
  func sendRemoteInput(_ payload: [UInt8], urgent: Bool) -> Bool
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescGattClient.kt
internal final class VescGattClient: NSObject, SessionTransport {
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescGattClient.kt `recorder`
  var recorder: (() -> SessionRecorder?)?
  private weak var listener: VescGattListener?
  private let scheduler: Scheduler
  static let sessionRestoreIdentifier = "com.vescape.core.session-central"
  private let restoreIdentifier: String?
  private let centralFactory: (() -> VescCentralManager)?
  private lazy var central: VescCentralManager = {
    if let centralFactory { return centralFactory() }
    guard let restoreIdentifier else { return CBCentralManager(delegate: self, queue: nil) }
    return CBCentralManager(
      delegate: self,
      queue: nil,
      options: [CBCentralManagerOptionRestoreIdentifierKey: restoreIdentifier]
    )
  }()
  private var restoredPeripherals: [CBPeripheral] = []
  private var pendingRestoreAdoptId: UUID?

  private var peripheral: VescPeripheral?
  private var txChar: CBCharacteristic?
  private var writeType: CBCharacteristicWriteType = .withoutResponse
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescGattClient.kt `writeQueue`
  private let writeQueue = VescWriteQueue()
  private var pendingNotifyEnables = 0
  private var notifyTimeout: Cancellable?
  private var readyResolved = false
  private var linkUp = false
  private var intentionalDisconnect = false

  private var isDiscoveryScanning = false
  private var connectTargetId: UUID?

  private var pendingDiscoveryScan = false
  private(set) var pendingConnectId: UUID?
  private var pendingReconnect = false
  private var lastConnectId: UUID?

  init(
    listener: VescGattListener,
    restoreIdentifier: String? = nil,
    scheduler: Scheduler = MainQueueScheduler(),
    centralFactory: (() -> VescCentralManager)? = nil
  ) {
    self.listener = listener
    self.restoreIdentifier = restoreIdentifier
    self.scheduler = scheduler
    self.centralFactory = centralFactory
    super.init()
    _ = self.central
  }

  func startScan() {
    isDiscoveryScanning = true
    guard central.state == .poweredOn else {
      pendingDiscoveryScan = true
      return
    }
    beginScan()
  }

  func stopScan() {
    isDiscoveryScanning = false
    pendingDiscoveryScan = false
    if connectTargetId == nil {
      central.stopScan()
    }
  }

  func connect(peripheralId: String) {
    guard let uuid = UUID(uuidString: peripheralId) else {
      listener?.onGattFailure(code: "INVALID_DEVICE", message: "Malformed BLE id: \(peripheralId)")
      return
    }
    clear(markIntentional: true)
    lastConnectId = uuid

    guard central.state == .poweredOn else {
      pendingConnectId = uuid
      return
    }
    connectResolved(uuid)
  }

  private func connectResolved(_ uuid: UUID) {
    if let known = central.knownPeripherals([uuid]).first {
      connectPeripheral(known)
      return
    }
    if let live = central.connectedPeripherals([VescGattUUIDs.service]).first(where: {
      $0.identifier == uuid
    }) {
      connectPeripheral(live)
      return
    }
    connectTargetId = uuid
    beginScan()
  }

  private func connectPeripheral(_ peripheral: VescPeripheral) {
    self.peripheral = peripheral
    peripheral.delegate = self
    central.connect(peripheral, options: nil)
  }

  func disconnect() {
    lastConnectId = nil
    restoredPeripherals = []
    pendingRestoreAdoptId = nil
    clear(markIntentional: true)
  }

  @discardableResult
  func adoptRestored(peripheralId: String) -> Bool {
    guard
      let uuid = UUID(uuidString: peripheralId),
      let restored = restoredPeripherals.first(where: { $0.identifier == uuid })
    else { return false }
    restoredPeripherals = []
    intentionalDisconnect = false
    resetLinkState()
    lastConnectId = uuid
    peripheral = restored
    restored.delegate = self
    guard central.state == .poweredOn else {
      pendingRestoreAdoptId = uuid
      return true
    }
    resumeAdopted(restored)
    return true
  }

  private func resumeAdopted(_ peripheral: VescPeripheral) {
    guard peripheral === self.peripheral else { return }
    if peripheral.state == .connected {
      linkUp = true
      intentionalDisconnect = false
      listener?.onGattConnected()
      peripheral.discoverServices([VescGattUUIDs.service])
    } else {
      central.connect(peripheral, options: nil)
    }
  }

  /// @platform-diff Android has no gatt-level peer: its `connectGatt(autoConnect = false)` is
  func reconnect() {
    resetLinkState()
    pendingConnectId = nil
    guard central.state == .poweredOn else {
      pendingReconnect = true
      return
    }
    guard let peripheral else {
      reconnectViaTargetResolve()
      return
    }
    central.connect(peripheral, options: nil)
  }

  private func reconnectViaTargetResolve() {
    guard let target = lastConnectId else {
      listener?.onGattFailure(code: "RECONNECT_FAILED", message: "No peripheral to reconnect")
      return
    }
    connectResolved(target)
  }

  func startReconnectScan() {
    guard let peripheral, central.state == .poweredOn else { return }
    connectTargetId = peripheral.identifier
    beginScan()
  }

  func stopReconnectScan() {
    let needsTargetScan = connectTargetId != nil && peripheral == nil
    if !isDiscoveryScanning && !needsTargetScan {
      central.stopScan()
    }
  }

  func sendPayload(_ payload: [UInt8]) -> Bool {
    guard linkUp, peripheral != nil, txChar != nil else { return false }
    writeQueue.enqueueNormal(VescPacketCodec.encode(payload))
    return drainWriteQueue()
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescGattClient.kt `sendRemoteInput`
  func sendRemoteInput(_ payload: [UInt8], urgent: Bool) -> Bool {
    guard linkUp, peripheral != nil, txChar != nil else { return false }
    writeQueue.replaceRemoteInput(VescPacketCodec.encode(payload), urgent: urgent)
    return drainWriteQueue()
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescGattClient.kt `drainWriteQueue`
  @discardableResult
  private func drainWriteQueue() -> Bool {
    guard linkUp, let peripheral, let txChar else { return false }
    writeQueue.setChunkLimit(peripheral.maximumWriteValueLength(for: .withoutResponse))
    while true {
      if writeType == .withoutResponse, !peripheral.canSendWriteWithoutResponse {
        return true
      }
      guard let write = writeQueue.startNext() else { return true }
      peripheral.writeValue(Data(write.bytes), for: txChar, type: writeType)
      recorder?()?.recordChunk(direction: "tx", bytes: write.bytes)
      if writeType == .withResponse { return true }
      writeQueue.completeInFlight()
    }
  }

  private func clear(markIntentional: Bool) {
    resetLinkState()
    connectTargetId = nil
    pendingReconnect = false
    pendingConnectId = nil
    pendingRestoreAdoptId = nil
    if !isDiscoveryScanning {
      central.stopScan()
    }
    if let peripheral {
      if markIntentional { intentionalDisconnect = true }
      central.cancelPeripheralConnection(peripheral)
    }
    peripheral = nil
  }

  private func resetLinkState() {
    linkUp = false
    readyResolved = false
    notifyTimeout?.cancel()
    notifyTimeout = nil
    txChar = nil
    writeQueue.clear()
    pendingNotifyEnables = 0
  }

  private func beginScan() {
    central.scanForPeripherals(
      withServices: nil,
      options: [CBCentralManagerScanOptionAllowDuplicatesKey: true]
    )
  }

  private func resolveReady() {
    notifyTimeout?.cancel()
    notifyTimeout = nil
    guard linkUp, txChar != nil, !readyResolved else { return }
    readyResolved = true
    listener?.onGattReady()
  }
}

extension VescGattClient: CBCentralManagerDelegate {
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    centralStateDidChange(central.state)
  }

  func centralStateDidChange(_ state: CBManagerState) {
    switch state {
    case .poweredOn:
      if pendingDiscoveryScan {
        pendingDiscoveryScan = false
        beginScan()
      }
      if let uuid = pendingConnectId {
        pendingConnectId = nil
        connectResolved(uuid)
      }
      if pendingReconnect {
        pendingReconnect = false
        reconnect()
      }
      if let adoptId = pendingRestoreAdoptId {
        pendingRestoreAdoptId = nil
        if let peripheral, peripheral.identifier == adoptId {
          resumeAdopted(peripheral)
        }
      }
    case .poweredOff:
      if isDiscoveryScanning || pendingDiscoveryScan {
        listener?.onScanFailure("Bluetooth is off")
      }
      if pendingRestoreAdoptId != nil { return }
      if peripheral != nil || connectTargetId != nil || pendingConnectId != nil {
        resetLinkState()
        listener?.onGattFailure(code: "BLE_OFF", message: "Bluetooth is off")
      }
    case .unauthorized:
      listener?.onScanFailure("Bluetooth permission denied")
    default:
      break
    }
  }

  func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
    let peripherals = (dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral]) ?? []
    for peripheral in peripherals {
      peripheral.delegate = self
    }
    restoredPeripherals = peripherals
    listener?.onGattRestored(peripheralIds: peripherals.map { $0.identifier.uuidString })
  }

  func centralManager(
    _ central: CBCentralManager,
    didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any],
    rssi RSSI: NSNumber
  ) {
    if let target = connectTargetId, peripheral.identifier == target {
      connectTargetId = nil
      if !isDiscoveryScanning { central.stopScan() }
      connectPeripheral(peripheral)
      return
    }
    guard isDiscoveryScanning else { return }
    let name = (advertisementData[CBAdvertisementDataLocalNameKey] as? String)
      ?? peripheral.name
      ?? ""
    let serviceUUIDs = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID])?
      .map { $0.uuidString.lowercased() } ?? []
    listener?.onDeviceDiscovered(
      id: peripheral.identifier.uuidString,
      name: name,
      rssi: RSSI.intValue,
      serviceUUIDs: serviceUUIDs
    )
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    didConnect(peripheral)
  }

  func didConnect(_ peripheral: VescPeripheral) {
    guard peripheral === self.peripheral else { return }
    linkUp = true
    intentionalDisconnect = false
    listener?.onGattConnected()
    peripheral.discoverServices([VescGattUUIDs.service])
  }

  func centralManager(
    _ central: CBCentralManager,
    didFailToConnect peripheral: CBPeripheral,
    error: Error?
  ) {
    didFailToConnect(peripheral, error: error)
  }

  func didFailToConnect(_ peripheral: VescPeripheral, error: Error?) {
    guard peripheral === self.peripheral else { return }
    listener?.onGattFailure(code: "CONNECT_FAILED", message: error?.localizedDescription ?? "Connect failed")
  }

  func centralManager(
    _ central: CBCentralManager,
    didDisconnectPeripheral peripheral: CBPeripheral,
    error: Error?
  ) {
    didDisconnect(peripheral, error: error)
  }

  func didDisconnect(_ peripheral: VescPeripheral, error: Error?) {
    guard peripheral === self.peripheral else { return }
    let wasIntentional = intentionalDisconnect
    intentionalDisconnect = false
    resetLinkState()
    listener?.onGattDisconnected(
      intentional: wasIntentional,
      message: error?.localizedDescription ?? "Board disconnected"
    )
  }
}

extension VescGattClient: CBPeripheralDelegate {
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescGattClient.kt `onCharacteristicWrite`
  func peripheral(
    _ peripheral: CBPeripheral,
    didWriteValueFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    didWriteValue(peripheral, characteristic: characteristic, error: error)
  }

  func didWriteValue(_ peripheral: VescPeripheral, characteristic: CBCharacteristic, error: Error?) {
    guard linkUp, peripheral === self.peripheral, characteristic.uuid == VescGattUUIDs.tx else { return }
    let completed = writeQueue.completeInFlight(failed: error != nil)
    if let error {
      NSLog("gatt write callback failed bytes=\(completed?.bytes.count ?? 0): \(error.localizedDescription)")
    }
    drainWriteQueue()
  }

  func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
    readyToWrite(peripheral)
  }

  func readyToWrite(_ peripheral: VescPeripheral) {
    guard linkUp, peripheral === self.peripheral else { return }
    drainWriteQueue()
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    didDiscoverServices(peripheral, error: error)
  }

  func didDiscoverServices(_ peripheral: VescPeripheral, error: Error?) {
    guard linkUp, peripheral === self.peripheral else { return }
    listener?.onGattSubscribing()
    if let error {
      listener?.onGattFailure(code: "DISCOVERY_FAILED", message: error.localizedDescription)
      return
    }
    guard let service = peripheral.services?.first(where: { $0.uuid == VescGattUUIDs.service }) else {
      listener?.onGattFailure(code: "NO_CHAR", message: "NUS service not found")
      return
    }
    peripheral.discoverCharacteristics([VescGattUUIDs.tx, VescGattUUIDs.rx], for: service)
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didDiscoverCharacteristicsFor service: CBService,
    error: Error?
  ) {
    didDiscoverCharacteristics(peripheral, service: service, error: error)
  }

  func didDiscoverCharacteristics(_ peripheral: VescPeripheral, service: CBService, error: Error?) {
    guard linkUp, peripheral === self.peripheral else { return }
    if let error {
      listener?.onGattFailure(code: "DISCOVERY_FAILED", message: error.localizedDescription)
      return
    }
    let chars = service.characteristics ?? []
    guard
      let tx = chars.first(where: { $0.uuid == VescGattUUIDs.tx }),
      let rx = chars.first(where: { $0.uuid == VescGattUUIDs.rx })
    else {
      listener?.onGattFailure(code: "NO_CHAR", message: "NUS characteristics not found")
      return
    }
    txChar = tx
    writeType = tx.properties.contains(.write) ? .withResponse : .withoutResponse

    let notifiers = [rx, tx].filter { $0.properties.contains(.notify) || $0.properties.contains(.indicate) }
    guard !notifiers.isEmpty else {
      listener?.onGattFailure(code: "NO_CHAR", message: "No notifying NUS characteristic")
      return
    }
    pendingNotifyEnables = notifiers.count
    for characteristic in notifiers {
      peripheral.setNotifyValue(true, for: characteristic)
    }
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescGattClient.kt `cccdTimeout`
    notifyTimeout?.cancel()
    notifyTimeout = scheduler.postDelayed(1_000) { [weak self] in
      self?.resolveReady()
    }
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didUpdateNotificationStateFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    didUpdateNotificationState(peripheral, characteristic: characteristic, error: error)
  }

  func didUpdateNotificationState(_ peripheral: VescPeripheral, characteristic: CBCharacteristic, error: Error?) {
    guard linkUp, peripheral === self.peripheral else { return }
    guard pendingNotifyEnables > 0 else { return }
    pendingNotifyEnables -= 1
    if pendingNotifyEnables == 0 {
      resolveReady()
    }
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didUpdateValueFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    didUpdateValue(peripheral, characteristic: characteristic, error: error)
  }

  func didUpdateValue(_ peripheral: VescPeripheral, characteristic: CBCharacteristic, error: Error?) {
    guard linkUp, peripheral === self.peripheral else { return }
    guard characteristic.uuid == VescGattUUIDs.rx || characteristic.uuid == VescGattUUIDs.tx else { return }
    guard let value = characteristic.value else { return }
    listener?.onGattFrameChunk([UInt8](value))
  }
}

internal enum VescGattUUIDs {
  static let service = CBUUID(nsuuid: VescUartUUIDs.service)
  static let tx = CBUUID(nsuuid: VescUartUUIDs.tx)
  static let rx = CBUUID(nsuuid: VescUartUUIDs.rx)
}
