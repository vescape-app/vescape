import CoreBluetooth
import Foundation

/// Connection + scan lifecycle callbacks. All fire on the main queue (the central runs there),
/// so the coordinator mutates Board Session state without extra hopping. Mirrors the Android
/// `VescGattListener` phase surface.
///
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
  /// CoreBluetooth handed the session central's state back after the app was relaunched into the
  /// background (ADR 0034). `peripheralIds` are the peripherals iOS restored — empty when the link
  /// died while the process was dead, which is a resume through the normal reconnect path.
  ///
  /// @platform-diff No Android peer: its `CoreForegroundService` keeps the process alive, so there
  /// is nothing to restore.
  func onGattRestored(peripheralIds: [String])
}

/// Transport seam under `BoardSessionController` (ADR 0024): everything the controller calls on
/// the board link beyond the `VescGattListener` callbacks. The real `VescGattClient` speaks
/// CoreBluetooth; the dev-mode `ReplayTransport` plays a Debug Recording through the same surface.
/// `supportsReconnect` gates the reconnect loop: a replay ending is terminal, not recoverable.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescGattClient.kt `SessionTransport`
internal protocol SessionTransport: AnyObject {
  var supportsReconnect: Bool { get }
  func connect(peripheralId: String)
  func disconnect()
  func reconnect()
  func startReconnectScan()
  func stopReconnectScan()
  @discardableResult
  func sendPayload(_ payload: [UInt8]) -> Bool
  /// Enqueue transient remote input (tilt or Board Move) into the replaceable slot.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescGattClient.kt `sendRemoteInput`
  @discardableResult
  func sendRemoteInput(_ payload: [UInt8], urgent: Bool) -> Bool
}

/// CoreBluetooth wrapper around a single VESC board connection plus BLE scanning. Owns one
/// `CBCentralManager` shared by scan and connect; the coordinator drives phases through the
/// listener. Deliberately dumb: it exposes a persistent `reconnect()` (re-issuing CoreBluetooth's
/// self-retrying `connect`) and a supplemental rescan, but the reconnect *policy* — when to give
/// up, phase transitions, session identity — lives one layer up.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescGattClient.kt
internal final class VescGattClient: NSObject, SessionTransport {
  var supportsReconnect: Bool { true }
  /// Active raw debug Session Recorder resolver, set by the session controller. Records `tx`
  /// chunks at the write site (the peer of Android taping `tx` in its `VescGattClient`).
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescGattClient.kt `recorder`
  var recorder: (() -> SessionRecorder?)?
  private weak var listener: VescGattListener?
  private let scheduler: Scheduler
  /// Stable across app versions on purpose: iOS keys the preserved central state on this string, so
  /// changing it throws away every in-flight restoration. Only the Board Session client passes it;
  /// the Board Probe's client (`BoardTransportDetector`) stays bare — probing never needs
  /// resurrection, and two centrals may not share one restore identifier.
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
  /// Peripherals handed back by `willRestoreState`, held until the coordinator adopts one.
  private var restoredPeripherals: [CBPeripheral] = []
  /// Adoption requested before the central reported `.poweredOn` (restoration delivers
  /// `willRestoreState` first), completed from `centralManagerDidUpdateState`.
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

  /// True while emitting discovery devices to the listener (the `scan()` JS API).
  private var isDiscoveryScanning = false
  /// Set while scanning to locate a specific board to connect to.
  private var connectTargetId: UUID?

  /// Deferred until the central reports `.poweredOn`.
  private var pendingDiscoveryScan = false
  private(set) var pendingConnectId: UUID?
  /// A persistent reconnect queued while the central was not yet `.poweredOn`.
  private var pendingReconnect = false
  /// Target of the active connect session, retained across reconnects so a board that never
  /// connected this session (e.g. powered off at launch) can still be re-resolved. Cleared only by
  /// an intentional `disconnect()`.
  private var lastConnectId: UUID?

  /// `restoreIdentifier` opts this client's central into CoreBluetooth state restoration (ADR 0034).
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
    _ = self.central // Create during launch so state restoration starts before the resume window expires.
  }

  // MARK: - Scan (JS `scan()` API)

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
    // Keep scanning if a connect is still hunting for its target peripheral.
    if connectTargetId == nil {
      central.stopScan()
    }
  }

  // MARK: - Connect

  func connect(peripheralId: String) {
    guard let uuid = UUID(uuidString: peripheralId) else {
      listener?.onGattFailure(code: "INVALID_DEVICE", message: "Malformed BLE id: \(peripheralId)")
      return
    }
    // A lingering peripheral from a previous attempt keeps delivering callbacks; tear it down.
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
    // Not yet seen this launch: scan until the board advertises, then connect.
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

  // MARK: - State restoration (#378)

  /// Adopt a peripheral CoreBluetooth restored into this launch as the session's link. The GATT
  /// subscriptions survived the process death, but this object graph did not: the delegate is
  /// re-set and services re-discovered so `txChar` and the frame callbacks exist again.
  ///
  /// Returns false when the id is not among the restored peripherals, which routes the coordinator
  /// to a normal persistent connect instead.
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
      // Restoration delivers `willRestoreState` before the first state update; finish once the
      // radio reports in, or CoreBluetooth silently drops the discovery/connect.
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
      // Restored but dropped since: persistent connect keeps retrying on its own.
      central.connect(peripheral, options: nil)
    }
  }

  // MARK: - Reconnect (#58)

  /// Re-issue a persistent connect on the peripheral retained across an unintentional disconnect.
  /// `connect(_:options:)` is self-retrying — CoreBluetooth keeps trying until it succeeds or the
  /// connection is cancelled, even waking the app from suspension — so there is nothing to poll.
  ///
  /// @platform-diff Android has no gatt-level peer: its `connectGatt(autoConnect = false)` is
  /// one-shot and the `ReconnectScheduler` drives retries with a fresh connect each attempt. iOS
  /// leans on CoreBluetooth's built-in persistent connect instead (see `BoardSessionController`).
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

  /// Reconnect variant for a board that never yielded a retained peripheral this session (powered
  /// off since launch). Re-resolves from the stored target so a persistent connect or target scan
  /// keeps retrying instead of dead-ending. The peripheral-backed `reconnect()` is preferred when
  /// one exists; this is the fallback the coordinator's reconnect loop leans on otherwise.
  private func reconnectViaTargetResolve() {
    guard let target = lastConnectId else {
      listener?.onGattFailure(code: "RECONNECT_FAILED", message: "No peripheral to reconnect")
      return
    }
    connectResolved(target)
  }

  /// Open a supplemental scan window that reconnects the moment the retained peripheral advertises,
  /// accelerating rediscovery on top of the persistent connect's passive retry.
  func startReconnectScan() {
    guard let peripheral, central.state == .poweredOn else { return }
    connectTargetId = peripheral.identifier
    beginScan()
  }

  /// Close the supplemental scan window (persistent connect keeps running). A live JS `scan()`
  /// keeps the radio scanning.
  func stopReconnectScan() {
    // Keep scanning if a live JS `scan()` needs it, or if a peripheral-less reconnect is still
    // hunting for its target (tearing that down would abort the retry).
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

  /// Enqueue transient remote input (tilt or Board Move). Only the latest unsent value survives, so
  /// an emergency neutral command cannot sit behind stale tilt commands.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescGattClient.kt `sendRemoteInput`
  func sendRemoteInput(_ payload: [UInt8], urgent: Bool) -> Bool {
    guard linkUp, peripheral != nil, txChar != nil else { return false }
    writeQueue.replaceRemoteInput(VescPacketCodec.encode(payload), urgent: urgent)
    return drainWriteQueue()
  }

  /// One outstanding write at a time. Serializing all writes stops telemetry polling and held
  /// remote controls from dropping each other, and keeps the queue short enough that a neutral
  /// reaches the board while the rider's finger is still lifting.
  ///
  /// `.withResponse` writes resume from `didWriteValueFor`; `.withoutResponse` writes have no
  /// completion callback, so they complete inline and back off on `canSendWriteWithoutResponse`,
  /// resuming from `peripheralIsReady`.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescGattClient.kt `drainWriteQueue`
  @discardableResult
  private func drainWriteQueue() -> Bool {
    guard linkUp, let peripheral, let txChar else { return false }
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

  // MARK: - Teardown

  private func clear(markIntentional: Bool) {
    resetLinkState()
    connectTargetId = nil
    pendingReconnect = false
    // A connect deferred until Bluetooth powers on belongs to the cancelled attempt too.
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
    // A cancelled write may never complete. Neither it nor queued commands belong to the next link.
    writeQueue.clear()
    pendingNotifyEnables = 0
  }

  private func beginScan() {
    // Scan unfiltered, mirroring Android's null-filter scan. VESC boards (Nordic UART BLE
    // modules) don't advertise the NUS service UUID in the advertisement packet — it only
    // appears in the GATT table after connecting — so `withServices: [NUS]` never surfaces
    // them. The board is identified by name/id at the UI layer, not by advertised service.
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

// MARK: - CBCentralManagerDelegate

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
      // A restored session waiting to adopt its peripheral is not a failed connect: failing it here
      // would tear the session down and drop the durable resume marker, so a later power-on could
      // never finish the adoption. Radio off is a pause; the adoption stays deferred (ADR 0034).
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

  /// iOS relaunched the app (headlessly, on a board notification) and is handing the session
  /// central's preserved state back. Peripherals are retained and their delegate re-set here; the
  /// decision of what to do with them — rebuild the Board Session, or fall back to a normal
  /// reconnect when none came back — belongs to the coordinator (ADR 0034).
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
    // clear() already released the old reference. If this callback still matches, CoreBluetooth
    // returned the same object for a pending new attempt; keep it so didConnect can finish that attempt.
    listener?.onGattDisconnected(
      intentional: wasIntentional,
      message: error?.localizedDescription ?? "Board disconnected"
    )
  }
}

// MARK: - CBPeripheralDelegate

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
    let completed = writeQueue.completeInFlight()
    if let error {
      NSLog("gatt write callback failed bytes=\(completed?.bytes.count ?? 0): \(error.localizedDescription)")
    }
    drainWriteQueue()
  }

  /// `.withoutResponse` back-pressure released: resume draining.
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

    // Subscribe to whichever of tx/rx actually notify; the board streams telemetry there.
    let notifiers = [rx, tx].filter { $0.properties.contains(.notify) || $0.properties.contains(.indicate) }
    guard !notifiers.isEmpty else {
      listener?.onGattFailure(code: "NO_CHAR", message: "No notifying NUS characteristic")
      return
    }
    pendingNotifyEnables = notifiers.count
    for characteristic in notifiers {
      peripheral.setNotifyValue(true, for: characteristic)
    }
    // Some boards never ack the subscribe. Leave room for this fallback before the session's
    // 2s handshake deadline, and cancel it on ready/teardown so it cannot resolve a later attempt.
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

/// NUS UUIDs as `CBUUID`, sourced from the shared `VescUartUUIDs` so iOS keeps one truth.
internal enum VescGattUUIDs {
  static let service = CBUUID(nsuuid: VescUartUUIDs.service)
  static let tx = CBUUID(nsuuid: VescUartUUIDs.tx)
  static let rx = CBUUID(nsuuid: VescUartUUIDs.rx)
}
