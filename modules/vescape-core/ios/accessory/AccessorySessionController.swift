import CoreBluetooth
import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySessionManager.kt
public final class AccessorySessionController: NSObject {
  public static let shared = AccessorySessionController()

  private static let preferredRateHz: Double = 10

  private static let restoreIdentifier = "com.vescape.accessory.sessions"

  var emit: ((String, [String: Any?]) -> Void)?

  private var central: CBCentralManager?
  private var links: [String: AccessoryLink] = [:]
  private var saved: [String: SavedAccessory] = [:]
  private var capabilityEnabled: [GroundClearanceBindingController.Key: Bool] = [:]
  private var samplingRates: [GroundClearanceBindingController.Key: Double] = [:]
  private var order: [String] = []
  private var store: AccessoryStore { AccessoryStore.shared }

  private let brakeLight = BrakeLightController()
  private var lightExpiry: DispatchWorkItem?

  private let groundClearance = GroundClearanceBindingController(
    nowMs: { Int64(ProcessInfo.processInfo.systemUptime * 1000) })

  private var restored: [UUID: CBPeripheral] = [:]

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

  var hasSessions: Bool { !links.isEmpty }

  func stopAll() {
    onMain {
      self.links.values.forEach { $0.stop() }
      self.links.removeAll()
      self.publish()
    }
  }

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
        capabilitiesJson: Self.encodeCapabilities(manifest["capabilities"] ?? nil),
        enrolledAt: Int64(Date().timeIntervalSince1970 * 1000),
        lastConnectedAt: nil)
      self.onMain {
        do {
          let stored = try self.store.upsert(row)
          self.remember(stored)
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

  func forget(accessoryId: String, onResult: @escaping (Bool) -> Void) {
    onMain {
      let removed: Bool
      do {
        removed = try self.store.forget(accessoryId)
      } catch {
        RecordingStorageFailure.report(
          operation: "accessory_forget", category: "write_failed", error: error)
        return onResult(false)
      }
      self.links.removeValue(forKey: accessoryId)?.stop()
      self.saved.removeValue(forKey: accessoryId)
      self.order.removeAll { $0 == accessoryId }
      self.groundClearance.forget(accessoryId)
      self.brakeLight.forget(accessoryId)
      self.capabilityEnabled = self.capabilityEnabled.filter { $0.key.accessoryId != accessoryId }
      self.samplingRates = self.samplingRates.filter { $0.key.accessoryId != accessoryId }
      self.publish()
      onResult(removed)
    }
  }

  func snapshot() -> [[String: Any?]] {
    order.compactMap { accessoryId in
      guard let row = saved[accessoryId] else { return nil }
      let link = links[accessoryId]
      let live = link?.manifest
      return [
        "accessoryId": row.accessoryId,
        "name": live?.name ?? row.name,
        "firmwareVersion": live?.firmwareVersion ?? row.firmwareVersion,
        "protocolVersion": live?.protocolVersion ?? row.protocolVersion,
        "deviceId": row.deviceId,
        "enrolledAt": row.enrolledAt,
        "lastConnectedAt": row.lastConnectedAt,
        "phase": (link?.phase ?? .idle).rawValue,
        "error": link?.lastError,
        "compatibility": live?.compatibility.rawValue,
        "capabilities": (live?.capabilities.map { $0.toMap() }
          ?? Self.decodeCapabilities(row.capabilitiesJson))
          .map { self.describeCapability(row.accessoryId, $0) },
        "capabilitiesChanged": live.map {
          Self.encodeCapabilities($0.capabilities.map { $0.toMap() }) != row.capabilitiesJson
        } ?? false,
        "leaseHeldMs": link?.lastAckAt.map {
          Int((ProcessInfo.processInfo.systemUptime - $0) * 1000)
        },
      ]
    }
  }

  private func onMain(_ work: @escaping () -> Void) {
    if Thread.isMainThread { work() } else { DispatchQueue.main.async(execute: work) }
  }

  private func publish() {
    emit?("onAccessoryState", ["accessories": snapshot()])
  }

  /// @parity /modules/vescape-core/src/index.ts `AccessoryCapability`
  private func describeCapability(_ accessoryId: String, _ capability: [String: Any?]) -> [String:
    Any?]
  {
    guard let capabilityId = capability["id"] as? String else { return capability }
    let capability = capability.merging([
      "enabled": isCapabilityEnabled(accessoryId, capabilityId),
      "samplingRateHz": links[accessoryId]?.appliedRateHz(capabilityId),
      "selectedRateHz": AccessorySession.resolveRateHz(
        requested: samplingRates[.init(accessoryId: accessoryId, capabilityId: capabilityId)] ?? Self.preferredRateHz,
        ratesHz: capability["ratesHz"] as? [Double] ?? []),
    ]) { _, value in value }
    if capability["type"] as? String == AccessoryProtocol.typeBrakeLight,
      let id = capability["id"] as? String {
      return capability.merging(brakeLight.describe(.init(accessoryId: accessoryId, capabilityId: id))) { _, value in value }
    }
    guard let binding = groundClearance.describe(accessoryId, capabilityId)
    else { return capability }
    return capability.merging(binding) { _, bindingValue in bindingValue }
  }

  private func loadSaved() {
    let rows: [SavedAccessory]
    do {
      rows = try store.accessories()
    } catch {
      RecordingStorageFailure.reportRead(operation: "accessory_list", error: error)
      return
    }
    do {
      let settings = try store.capabilitySettings()
      capabilityEnabled = Dictionary(uniqueKeysWithValues: settings.map {
        (GroundClearanceBindingController.Key(accessoryId: $0.accessoryId, capabilityId: $0.capabilityId), $0.enabled)
      })
      samplingRates.removeAll()
      for setting in settings {
        samplingRates[.init(accessoryId: setting.accessoryId, capabilityId: setting.capabilityId)] = setting.samplingRateHz
      }
    } catch {
      RecordingStorageFailure.reportRead(operation: "accessory_capability_settings", error: error)
      return
    }
    let calibrations: [SavedGroundClearance]
    do {
      calibrations = try store.groundClearances()
    } catch {
      RecordingStorageFailure.reportRead(operation: "accessory_ground_clearance", error: error)
      calibrations = []
    }
    do {
      for settings in try store.brakeLights() {
        brakeLight.configure(.init(accessoryId: settings.accessoryId, capabilityId: settings.capabilityId), .init(sensitivity: settings.sensitivity, parked: settings.parked))
      }
    } catch { RecordingStorageFailure.reportRead(operation: "accessory_brake_light", error: error) }
    saved.removeAll()
    order.removeAll()
    groundClearance.reset(calibrations.map { row in
      (
        GroundClearanceBindingController.Key(
          accessoryId: row.accessoryId, capabilityId: row.capabilityId),
        GroundClearanceCalibration(
          nearCm: row.nearCm, farCm: row.farCm, direction: row.direction,
          strengthPercent: row.strengthPercent)
      )
    })
    rows.forEach { remember($0) }
    rows.forEach { start($0) }
    publish()
  }

  private func remember(_ row: SavedAccessory) {
    if saved[row.accessoryId] == nil { order.append(row.accessoryId) }
    saved[row.accessoryId] = row
  }

  private func start(_ row: SavedAccessory) {
    guard let central else { return }
    let link: AccessoryLink
    if let existing = links[row.accessoryId] {
      link = existing
    } else {
      let accessoryId = row.accessoryId
      link = AccessoryLink(
        accessoryId: accessoryId,
        central: central,
        onChanged: { [weak self] in self?.publish() },
        onManifest: { [weak self] manifest, deviceId in
          self?.onManifestValidated(manifest, deviceId: deviceId)
        },
        onReading: { [weak self] reading, receivedAt in
          self?.onReading(accessoryId, reading, receivedAt)
        },
        onSessionLost: { [weak self] in self?.onSessionLost(accessoryId) })
      links[row.accessoryId] = link
    }
    applyDemand(to: link, row: row, manifest: nil)
    link.start(peripheral: peripheral(for: row))
  }

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

  private func onManifestValidated(_ manifest: AccessoryManifest, deviceId: String) {
    guard let previous = saved[manifest.accessoryId] else { return }
    let row = SavedAccessory(
      accessoryId: previous.accessoryId,
      name: manifest.name,
      firmwareVersion: manifest.firmwareVersion,
      protocolVersion: manifest.protocolVersion,
      deviceId: deviceId,
      capabilitiesJson: previous.capabilitiesJson,
      enrolledAt: previous.enrolledAt,
      lastConnectedAt: Int64(Date().timeIntervalSince1970 * 1000))
    remember(row)
    if let link = links[manifest.accessoryId] {
      applyDemand(to: link, row: row, manifest: manifest)
    }
    do {
      try store.revalidate(row)
    } catch {
      RecordingStorageFailure.report(
        operation: "accessory_revalidate", category: "write_failed", error: error)
    }
  }

  private func applyDemand(
    to link: AccessoryLink, row: SavedAccessory, manifest: AccessoryManifest?
  ) {
    let capabilities =
      manifest?.capabilities ?? Self.capabilitiesFrom(json: row.capabilitiesJson)
    for capability in capabilities where capability.supported {
      switch capability.type {
      case AccessoryProtocol.typeGroundClearance:
        guard
          let rate = AccessorySession.resolveRateHz(
            requested: samplingRates[.init(accessoryId: row.accessoryId, capabilityId: capability.id)] ?? Self.preferredRateHz, ratesHz: capability.ratesHz)
        else { continue }
        link.setDesired(
          groundClearance.applyCapability(
            accessoryId: row.accessoryId, capability: capability, liveManifest: manifest != nil,
            rateHz: rate, enabled: isCapabilityEnabled(row.accessoryId, capability.id)))
      case AccessoryProtocol.typeBrakeLight:
        link.setDesired(brakeLight.command(.init(accessoryId: row.accessoryId, capabilityId: capability.id), enabled: isCapabilityEnabled(row.accessoryId, capability.id)))
      default:
        continue
      }
    }
  }

  private func reapplyDemand() {
    for (accessoryId, link) in links {
      guard let row = saved[accessoryId] else { continue }
      applyDemand(to: link, row: row, manifest: link.manifest)
    }
  }

  private func isCapabilityEnabled(_ accessoryId: String, _ capabilityId: String) -> Bool {
    capabilityEnabled[.init(accessoryId: accessoryId, capabilityId: capabilityId)] != false
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySessionManager.kt `setCapabilityEnabled`
  /// @parity /modules/vescape-core/src/index.ts `setAccessoryCapabilityEnabled`
  func setCapabilityEnabled(accessoryId: String, capabilityId: String, enabled: Bool, onResult: @escaping (Bool) -> Void) {
    updateCapabilitySettings(accessoryId: accessoryId, capabilityId: capabilityId, enabled: enabled, rateHz: nil, onResult: onResult)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySessionManager.kt `setSamplingRate`
  /// @parity /modules/vescape-core/src/index.ts `setAccessorySamplingRate`
  func setSamplingRate(accessoryId: String, capabilityId: String, rateHz: Double, onResult: @escaping (Bool) -> Void) {
    updateCapabilitySettings(accessoryId: accessoryId, capabilityId: capabilityId, enabled: nil, rateHz: rateHz, onResult: onResult)
  }

  private func updateCapabilitySettings(accessoryId: String, capabilityId: String, enabled: Bool?, rateHz: Double?, onResult: @escaping (Bool) -> Void) {
    onMain {
      guard let row = self.saved[accessoryId] else { return onResult(false) }
      let capabilities = self.links[accessoryId]?.manifest?.capabilities ?? Self.capabilitiesFrom(json: row.capabilitiesJson)
      guard let capability = capabilities.first(where: { $0.id == capabilityId && $0.supported }) else { return onResult(false) }
      if let rateHz, capability.type != AccessoryProtocol.typeGroundClearance || !rateHz.isFinite || !capability.ratesHz.contains(rateHz) { return onResult(false) }
      let key = GroundClearanceBindingController.Key(accessoryId: accessoryId, capabilityId: capabilityId)
      let candidate = SavedAccessoryCapabilitySettings(accessoryId: accessoryId, capabilityId: capabilityId,
        enabled: enabled ?? self.isCapabilityEnabled(accessoryId, capabilityId), samplingRateHz: rateHz ?? self.samplingRates[key])
      do {
        try self.store.saveCapabilitySettings(candidate)
      } catch {
        RecordingStorageFailure.report(operation: "accessory_capability_settings", category: "write_failed", error: error)
        return onResult(false)
      }
      self.capabilityEnabled[key] = candidate.enabled
      self.samplingRates[key] = candidate.samplingRateHz
      if !candidate.enabled { _ = self.brakeLight.preview(.init(accessoryId: accessoryId, capabilityId: capabilityId), mode: nil) }
      self.reapplyDemand()
      self.publish()
      onResult(true)
    }
  }

  func setLightTelemetry(speedKmh: Double, riding: Bool) {
    let receivedAt = Int64(ProcessInfo.processInfo.systemUptime * 1000)
    onMain {
      guard Int64(ProcessInfo.processInfo.systemUptime * 1000) - receivedAt < 1500 else { return }
      let changed = self.brakeLight.sample(speed: speedKmh, engaged: riding, at: receivedAt)
      self.lightExpiry?.cancel()
      let expiry = DispatchWorkItem { [weak self] in self?.clearLightTelemetry() }
      self.lightExpiry = expiry
      DispatchQueue.main.asyncAfter(deadline: .now() + Double(1500 - (Int64(ProcessInfo.processInfo.systemUptime * 1000) - receivedAt)) / 1000, execute: expiry)
      self.reapplyDemand()
      if changed { self.publish() }
    }
  }

  func clearLightTelemetry() {
    onMain {
      self.lightExpiry?.cancel(); self.lightExpiry = nil
      self.brakeLight.clear(); self.reapplyDemand(); self.publish()
    }
  }

  func setLightPreview(accessoryId: String, capabilityId: String, mode: String?, onResult: @escaping (Bool) -> Void) {
    onMain {
      if mode != nil && !self.isCapabilityEnabled(accessoryId, capabilityId) { return onResult(false) }
      let accepted = self.brakeLight.preview(.init(accessoryId: accessoryId, capabilityId: capabilityId), mode: mode)
      if accepted { self.reapplyDemand(); self.publish() }
      onResult(accepted)
    }
  }

  func saveBrakeLight(accessoryId: String, capabilityId: String, sensitivity: Int, parked: String, onResult: @escaping (Bool) -> Void) {
    onMain {
      let candidate = BrakeLightSettings(sensitivity: sensitivity, parked: parked)
      let capabilities = self.links[accessoryId]?.manifest?.capabilities
        ?? self.saved[accessoryId].map { Self.capabilitiesFrom(json: $0.capabilitiesJson) } ?? []
      guard candidate.valid, capabilities.contains(where: { $0.id == capabilityId && $0.type == AccessoryProtocol.typeBrakeLight && $0.supported }) else { return onResult(false) }
      do {
        try self.store.saveBrakeLight(.init(accessoryId: accessoryId, capabilityId: capabilityId, sensitivity: sensitivity, parked: parked))
        self.brakeLight.configure(.init(accessoryId: accessoryId, capabilityId: capabilityId), candidate)
        self.reapplyDemand(); self.publish(); onResult(true)
      } catch {
        RecordingStorageFailure.report(operation: "accessory_brake_light", category: "write_failed", error: error)
        onResult(false)
      }
    }
  }

  func setPreview(accessoryId: String, capabilityId: String, open: Bool) {
    onMain {
      guard self.groundClearance.setPreview(accessoryId, capabilityId, open: open) else { return }
      self.reapplyDemand()
      self.publish()
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySessionManager.kt `releasePreviews`
  func releasePreviews() {
    onMain {
      self.groundClearance.releasePreviews()
      self.brakeLight.releasePreviews()
      self.reapplyDemand()
      self.publish()
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySessionManager.kt `setRiding`
  func setRiding(_ riding: Bool) {
    onMain {
      guard self.groundClearance.setRiding(riding) else { return }
      self.reapplyDemand()
      self.publish()
    }
  }

  func saveGroundClearance(
    accessoryId: String, capabilityId: String, nearCm: Double, farCm: Double, direction: String,
    strengthPercent: Int, onResult: @escaping ([String: Any?]) -> Void
  ) {
    onMain {
      guard let row = self.saved[accessoryId] else {
        return onResult(["saved": false, "problem": "unknown-capability"])
      }
      let candidate = GroundClearanceCalibration(
        nearCm: nearCm, farCm: farCm, direction: direction, strengthPercent: strengthPercent)
      if let problem = self.groundClearance.validate(accessoryId, capabilityId, candidate) {
        return onResult(["saved": false, "problem": problem.rawValue])
      }
      do {
        try self.store.saveGroundClearance(
          SavedGroundClearance(
            accessoryId: accessoryId, capabilityId: capabilityId, nearCm: nearCm, farCm: farCm,
            direction: direction, strengthPercent: strengthPercent,
            updatedAt: Int64(Date().timeIntervalSince1970 * 1000)))
      } catch {
        RecordingStorageFailure.report(
          operation: "accessory_ground_clearance", category: "write_failed", error: error)
        return onResult(["saved": false, "problem": "storage-unavailable"])
      }
      if let live = self.links[accessoryId]?.manifest?.capabilities {
        let baseline = Self.encodeCapabilities(live.map { $0.toMap() })
        do {
          try self.store.adoptCapabilities(accessoryId, capabilitiesJson: baseline)
          self.remember(
            SavedAccessory(
              accessoryId: row.accessoryId, name: row.name, firmwareVersion: row.firmwareVersion,
              protocolVersion: row.protocolVersion, deviceId: row.deviceId,
              capabilitiesJson: baseline, enrolledAt: row.enrolledAt,
              lastConnectedAt: row.lastConnectedAt))
        } catch {
          RecordingStorageFailure.report(
            operation: "accessory_revalidate", category: "write_failed", error: error)
        }
      }
      self.groundClearance.applyCalibration(accessoryId, capabilityId, candidate)
      self.reapplyDemand()
      self.publish()
      onResult(["saved": true, "problem": nil])
    }
  }

  func clearGroundClearance(
    accessoryId: String, capabilityId: String, onResult: @escaping (Bool) -> Void
  ) {
    onMain {
      let removed: Bool
      do {
        removed = try self.store.clearGroundClearance(accessoryId, capabilityId)
      } catch {
        RecordingStorageFailure.report(
          operation: "accessory_ground_clearance", category: "write_failed", error: error)
        return onResult(false)
      }
      self.groundClearance.clearCalibration(accessoryId, capabilityId)
      self.reapplyDemand()
      self.publish()
      onResult(removed)
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySessionManager.kt `groundClearanceInput`
  func groundClearanceInput(accessoryId: String, capabilityId: String) -> GroundClearanceInput {
    groundClearance.input(accessoryId, capabilityId, link: linkState(accessoryId, capabilityId))
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySessionManager.kt `groundClearanceBound`
  func groundClearanceBound() -> Bool { groundClearance.bound(linkState) }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySessionManager.kt `groundClearanceTilt`
  func groundClearanceTilt() -> GroundClearanceInput {
    groundClearance.tilt(linkState)
  }

  private func linkState(_ accessoryId: String, _ capabilityId: String)
    -> GroundClearanceBindingController.LinkState
  {
    let link = links[accessoryId]
    return GroundClearanceBindingController.LinkState(
      connected: link?.phase == .connected, appliedRateHz: link?.appliedRateHz(capabilityId) ?? 0)
  }

  private func onReading(
    _ accessoryId: String, _ reading: AccessoryReading, _ receivedAt: TimeInterval
  ) {
    guard let payload = groundClearance.acceptReading(
      accessoryId, reading, receivedAtMs: Int64(receivedAt * 1000),
      appliedRateHz: links[accessoryId]?.appliedRateHz(reading.capabilityId))
    else { return }
    emit?("onAccessoryReading", payload)
  }

  private func onSessionLost(_ accessoryId: String) {
    groundClearance.onSessionLost(accessoryId)
  }

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
    order.compactMap { saved[$0] }.forEach { start($0) }
    links.values.forEach { $0.onRadioAvailable() }
  }

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
