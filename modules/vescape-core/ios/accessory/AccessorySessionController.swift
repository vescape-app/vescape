import CoreBluetooth
import Foundation

/// Enrolled Accessories: what is saved, what is connected, and the sessions in between.
///
/// The durable half lives in the database and the live half in `AccessoryLink`; this controller is
/// the only place the two meet. Two rules shape it:
///
/// - **Only enrolled Accessories auto-connect.** Discovery finds hardware; the rider adds it. A
///   device that merely advertises nearby is never given a session, so nothing on it can be started
///   by walking past it.
/// - **Identity is the manifest's accessory id.** Enrollment reads a manifest natively rather than
///   trusting one handed over the bridge, and every reconnect re-reads it. A renamed unit updates
///   its row; a different unit on a remembered handle is refused.
///
/// A central of its own with a restore identifier, deliberately separate from both the Board
/// Session's central and `AccessoryDiscovery`'s. Restoration is what lets iOS relaunch the app for
/// an Accessory link the way `CoreForegroundService` keeps Android's process alive — and it only
/// works when the central is re-created inside `didFinishLaunchingWithOptions`, which is why
/// `prepareForLaunch()` exists and why JS never creates this.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySessionManager.kt
public final class AccessorySessionController: NSObject {
  public static let shared = AccessorySessionController()

  /// `docs/accessory-protocol.md` PoC default, resolved against whatever the manifest offers.
  private static let preferredRateHz: Double = 20

  private static let restoreIdentifier = "com.vescape.accessory.sessions"

  /// Set by the Expo module so state can be pushed without holding a module reference.
  var emit: ((String, [String: Any?]) -> Void)?

  private var central: CBCentralManager?
  private var links: [String: AccessoryLink] = [:]
  private var saved: [String: SavedAccessory] = [:]
  private var order: [String] = []
  /// Capabilities whose declared limits moved since enrollment, per accessory.
  private var capabilitiesChanged: Set<String> = []
  private var store: AccessoryStore { AccessoryStore.shared }

  /// Peripherals handed back by state restoration before the saved rows have been read.
  private var restored: [UUID: CBPeripheral] = [:]

  /// Brings up every enrolled Accessory's session.
  ///
  /// Called from the app-delegate launch hook, not from JS coming up. Safe to call repeatedly: a
  /// link already started is left alone.
  public func prepareForLaunch() {
    onMain {
      if self.central == nil {
        self.central = CBCentralManager(
          delegate: self, queue: nil,
          options: [CBCentralManagerOptionRestoreIdentifierKey: Self.restoreIdentifier])
      }
      self.loadSaved()
    }
  }

  /// True when at least one Accessory is enrolled and holding a link.
  var hasSessions: Bool { !links.isEmpty }

  func stopAll() {
    onMain {
      self.links.values.forEach { $0.stop() }
      self.links.removeAll()
      self.publish()
    }
  }

  /// Adds one Accessory the rider picked, by reading its manifest natively first.
  ///
  /// The manifest is never taken from the bridge. JS supplies a device handle it saw in a scan;
  /// identity, protocol version and capability limits are all decided here, so an enrollment can
  /// only ever record what the hardware actually said.
  func enroll(deviceId: String, onResult: @escaping ([String: Any?]) -> Void) {
    AccessoryDiscovery.shared.inspect(deviceId: deviceId) { [weak self] inspection in
      guard let self else { return }
      guard let manifest = inspection["manifest"] as? [String: Any?],
        let accessoryId = manifest["accessoryId"] as? String, !accessoryId.isEmpty
      else {
        return onResult([
          "accessoryId": nil, "error": (inspection["error"] as? String) ?? "connect-failed",
        ])
      }
      let row = SavedAccessory(
        accessoryId: accessoryId,
        name: (manifest["name"] as? String) ?? accessoryId,
        firmwareVersion: (manifest["firmwareVersion"] as? String) ?? "",
        protocolVersion: manifest["protocolVersion"] as? Int,
        deviceId: deviceId,
        capabilitiesJson: Self.encodeCapabilities(manifest["capabilities"]),
        enrolledAt: Int64(Date().timeIntervalSince1970 * 1000),
        lastConnectedAt: nil)
      self.onMain {
        do {
          let stored = try self.store.upsert(row)
          self.remember(stored)
          self.capabilitiesChanged.remove(accessoryId)
          self.start(stored)
          self.publish()
          onResult(["accessoryId": accessoryId, "error": nil])
        } catch {
          RecordingStorageFailure.report(
            operation: "accessory_enroll", category: "write_failed", error: error)
          onResult(["accessoryId": nil, "error": "storage-unavailable"])
        }
      }
    }
  }

  /// Drops the saved identity and the session with it. Forgetting is the only way one goes away.
  func forget(accessoryId: String, onResult: @escaping (Bool) -> Void) {
    onMain {
      let removed: Bool
      do {
        removed = try self.store.forget(accessoryId)
      } catch {
        // The saved identity is still there, so the Accessory is still enrolled. Tearing down the
        // live session anyway would make it come back on the next launch with no explanation.
        RecordingStorageFailure.report(
          operation: "accessory_forget", category: "write_failed", error: error)
        return onResult(false)
      }
      self.links.removeValue(forKey: accessoryId)?.stop()
      self.saved.removeValue(forKey: accessoryId)
      self.order.removeAll { $0 == accessoryId }
      self.capabilitiesChanged.remove(accessoryId)
      self.publish()
      onResult(removed)
    }
  }

  /// Current snapshot, for a late subscriber or a JS foreground restore.
  func snapshot() -> [[String: Any?]] {
    order.compactMap { accessoryId in
      guard let row = saved[accessoryId] else { return nil }
      let link = links[accessoryId]
      let live = link?.manifest
      return [
        "accessoryId": row.accessoryId,
        // The live manifest wins while one is held: an Accessory renamed since enrollment reads as
        // its current name straight away, and the saved row catches up on the same handshake.
        "name": live?.name ?? row.name,
        "firmwareVersion": live?.firmwareVersion ?? row.firmwareVersion,
        "protocolVersion": live?.protocolVersion ?? row.protocolVersion,
        "deviceId": row.deviceId,
        "enrolledAt": row.enrolledAt,
        "lastConnectedAt": row.lastConnectedAt,
        "phase": (link?.phase ?? .idle).rawValue,
        "error": link?.lastError,
        "compatibility": live?.compatibility.rawValue,
        "capabilities": live?.capabilities.map { $0.toMap() }
          ?? Self.decodeCapabilities(row.capabilitiesJson),
        // The declared limits moved since enrollment, so anything calibrated against the old ones
        // needs the rider to look at it again.
        "capabilitiesChanged": capabilitiesChanged.contains(row.accessoryId),
        "leaseHeldMs": link?.lastAckAt.map {
          Int((ProcessInfo.processInfo.systemUptime - $0) * 1000)
        },
      ]
    }
  }

  // MARK: - Internals

  private func onMain(_ work: @escaping () -> Void) {
    if Thread.isMainThread { work() } else { DispatchQueue.main.async(execute: work) }
  }

  private func publish() {
    emit?("onAccessoryState", ["accessories": snapshot()])
  }

  private func loadSaved() {
    let rows: [SavedAccessory]
    do {
      rows = try store.accessories()
    } catch {
      // Nothing starts, and the outage is reported rather than looking like "no Accessories".
      RecordingStorageFailure.reportRead(operation: "accessory_list", error: error)
      return
    }
    saved.removeAll()
    order.removeAll()
    rows.forEach { remember($0) }
    rows.forEach { start($0) }
    publish()
  }

  private func remember(_ row: SavedAccessory) {
    if saved[row.accessoryId] == nil { order.append(row.accessoryId) }
    saved[row.accessoryId] = row
  }

  private func start(_ row: SavedAccessory) {
    // Every link shares the one restore-identified central. A second central here would get its own
    // restoration identity and iOS would relaunch the app into a controller holding neither.
    guard let central else { return }
    let link: AccessoryLink
    if let existing = links[row.accessoryId] {
      link = existing
    } else {
      link = AccessoryLink(
        accessoryId: row.accessoryId,
        central: central,
        onChanged: { [weak self] in self?.publish() },
        onManifest: { [weak self] manifest, deviceId in
          self?.onManifestValidated(manifest, deviceId: deviceId)
        })
      links[row.accessoryId] = link
    }
    applyBaseline(to: link, row: row, manifest: nil)
    link.start(peripheral: peripheral(for: row))
  }

  /// The peripheral to connect to: one restoration handed back, else one resolved from the saved
  /// handle. A stale handle costs a failed connect and a retry, never a wrong Accessory — the
  /// manifest check is what decides identity.
  private func peripheral(for row: SavedAccessory) -> CBPeripheral? {
    guard let deviceId = row.deviceId, let uuid = UUID(uuidString: deviceId) else { return nil }
    if let restoredPeripheral = restored[uuid] {
      restoredPeripheral.delegate = self
      return restoredPeripheral
    }
    guard let central else { return nil }
    let found = central.retrievePeripherals(withIdentifiers: [uuid]).first
    found?.delegate = self
    return found
  }

  /// A handshake that produced a manifest for an Accessory we have saved.
  ///
  /// The row is refreshed from what the hardware just said — name, firmware, protocol version, the
  /// handle it answered on — and the capability set is compared against the one enrollment
  /// validated. A capability whose limits moved is flagged rather than silently accepted: saved
  /// calibration was made against the old numbers.
  private func onManifestValidated(_ manifest: AccessoryManifest, deviceId: String) {
    guard let previous = saved[manifest.accessoryId] else { return }
    let capabilitiesJson = Self.encodeCapabilities(manifest.capabilities.map { $0.toMap() })
    if capabilitiesJson != previous.capabilitiesJson {
      capabilitiesChanged.insert(manifest.accessoryId)
    }
    let row = SavedAccessory(
      accessoryId: previous.accessoryId,
      name: manifest.name,
      firmwareVersion: manifest.firmwareVersion,
      protocolVersion: manifest.protocolVersion,
      deviceId: deviceId,
      capabilitiesJson: capabilitiesJson,
      enrolledAt: previous.enrolledAt,
      lastConnectedAt: Int64(Date().timeIntervalSince1970 * 1000))
    remember(row)
    if let link = links[manifest.accessoryId] {
      applyBaseline(to: link, row: row, manifest: manifest)
    }
    do {
      try store.upsert(row)
    } catch {
      // The session is live and correct; only the saved copy of what the manifest just said is
      // stale, which the next successful handshake fixes.
      RecordingStorageFailure.report(
        operation: "accessory_revalidate", category: "write_failed", error: error)
    }
  }

  /// The baseline every session establishes for each capability it can drive.
  ///
  /// Both are the protocol's own neutral state, not a feature: a clearance sensor is held in
  /// measurement standby, and a light is told plainly that Board telemetry is unavailable. They
  /// exist so the session has a real acknowledged command to hold — which is what makes the lease,
  /// the retry and the expiry observable before any capability's own behaviour is built. The slices
  /// that own those capabilities replace these with the rider's actual demand.
  private func applyBaseline(
    to link: AccessoryLink, row: SavedAccessory, manifest: AccessoryManifest?
  ) {
    let capabilities =
      manifest?.capabilities ?? Self.capabilitiesFrom(json: row.capabilitiesJson)
    for capability in capabilities where capability.supported {
      switch capability.type {
      case AccessoryProtocol.typeGroundClearance:
        guard
          let rate = AccessorySession.resolveRateHz(
            requested: Self.preferredRateHz, ratesHz: capability.ratesHz)
        else { continue }
        link.setDesired(.configure(capabilityId: capability.id, enabled: false, rateHz: rate))
      case AccessoryProtocol.typeBrakeLight:
        link.setDesired(
          .state(
            capabilityId: capability.id, telemetry: "unavailable", mode: nil, parked: "off",
            preview: false))
      default:
        continue
      }
    }
  }

  // MARK: - Capability encoding

  /// Key order is fixed so two encodings of the same capability set compare equal as text.
  private static func encodeCapabilities(_ raw: Any?) -> String {
    guard let list = raw as? [[String: Any?]] else { return "[]" }
    let parts = list.map { entry -> String in
      var out = "{\"id\":\(AccessoryProtocol.quote((entry["id"] as? String) ?? ""))"
      out += ",\"type\":\(AccessoryProtocol.quote((entry["type"] as? String) ?? ""))"
      out += ",\"supported\":\((entry["supported"] as? Bool) == true)"
      out += ",\"unit\":\((entry["unit"] as? String).map(AccessoryProtocol.quote) ?? "null")"
      out += ",\"rangeMin\":\(numberOrNull(entry["rangeMin"] ?? nil))"
      out += ",\"rangeMax\":\(numberOrNull(entry["rangeMax"] ?? nil))"
      let rates = ((entry["ratesHz"] as? [Double]) ?? []).map { number($0) }.joined(separator: ",")
      return out + ",\"ratesHz\":[\(rates)]}"
    }
    return "[" + parts.joined(separator: ",") + "]"
  }

  private static func numberOrNull(_ value: Any?) -> String {
    guard let value = value as? Double else { return "null" }
    return number(value)
  }

  private static func number(_ value: Double) -> String {
    if value.isFinite, value == value.rounded(.down), abs(value) < 1e15 { return String(Int64(value)) }
    return String(value)
  }

  private static func decodeCapabilities(_ json: String) -> [[String: Any?]] {
    capabilitiesFrom(json: json).map { $0.toMap() }
  }

  private static func capabilitiesFrom(json: String) -> [AccessoryCapability] {
    // intentional-suppression: a capability blob that will not decode is a capability set this app
    // cannot trust; an empty list is the outcome, and the next handshake rewrites the row.
    guard let data = json.data(using: .utf8),
      let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    else { return [] }
    return list.compactMap { entry in
      guard let id = entry["id"] as? String, let type = entry["type"] as? String else { return nil }
      return AccessoryCapability(
        id: id, type: type, supported: (entry["supported"] as? Bool) == true,
        unit: entry["unit"] as? String,
        rangeMin: (entry["rangeMin"] as? NSNumber)?.doubleValue,
        rangeMax: (entry["rangeMax"] as? NSNumber)?.doubleValue,
        ratesHz: (entry["ratesHz"] as? [NSNumber])?.map(\.doubleValue) ?? [])
    }
  }

  private func link(for peripheral: CBPeripheral) -> AccessoryLink? {
    links.values.first { $0.peripheral?.identifier == peripheral.identifier }
  }
}

extension AccessorySessionController: CBCentralManagerDelegate {
  public func centralManagerDidUpdateState(_ central: CBCentralManager) {
    guard central.state == .poweredOn else { return }
    // The links were created before the radio was usable; their first connect was refused and this
    // is where it becomes possible. Re-starting is idempotent.
    order.compactMap { saved[$0] }.forEach { start($0) }
  }

  /// iOS relaunched the app for a link this controller owned. The peripherals come back before the
  /// database has been read, so they are held until `loadSaved()` matches them to saved rows.
  public func centralManager(
    _ central: CBCentralManager, willRestoreState state: [String: Any]
  ) {
    let peripherals = (state[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral]) ?? []
    for peripheral in peripherals {
      peripheral.delegate = self
      restored[peripheral.identifier] = peripheral
    }
  }

  public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    peripheral.delegate = self
    link(for: peripheral)?.onConnected()
  }

  public func centralManager(
    _ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?
  ) {
    link(for: peripheral)?.onConnectFailed()
  }

  public func centralManager(
    _ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?
  ) {
    link(for: peripheral)?.onDisconnected()
  }
}

extension AccessorySessionController: CBPeripheralDelegate {
  public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    link(for: peripheral)?.onServicesDiscovered(error: error)
  }

  public func peripheral(
    _ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?
  ) {
    link(for: peripheral)?.onCharacteristicsDiscovered(for: service, error: error)
  }

  public func peripheral(
    _ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    link(for: peripheral)?.onNotifyStateChanged(for: characteristic, error: error)
  }

  public func peripheral(
    _ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?
  ) {
    link(for: peripheral)?.onWriteCompleted(error: error)
  }

  public func peripheral(
    _ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?
  ) {
    link(for: peripheral)?.onValueUpdated(for: characteristic, error: error)
  }
}
