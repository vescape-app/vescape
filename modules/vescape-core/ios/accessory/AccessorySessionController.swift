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
  private var store: AccessoryStore { AccessoryStore.shared }

  /// Live ground-clearance state, one per enrolled capability.
  ///
  /// Keyed on the Accessory *and* the capability, exactly as the durable row is: one unit may
  /// declare a nose sensor and a tail sensor, and they share neither a calibration nor a stream.
  private var clearance: [CapabilityKey: GroundClearanceRuntime] = [:]

  /// Whether the Board is carrying a rider, as the Board Session last saw it.
  ///
  /// One flag for every Accessory: v1 binds to whichever Board is connected, so there is exactly
  /// one riding state in the app and no per-Accessory version of it to disagree with.
  private var riding = false

  private struct CapabilityKey: Hashable {
    let accessoryId: String
    let capabilityId: String
  }

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
        // `?? nil` flattens `Any??`: without it the encoder receives a boxed optional rather than
        // the array, and every enrollment would record an empty capability set.
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
      // The calibrations went with the row in the same transaction; the live runtimes go with them,
      // so a re-enrollment starts from "not set up" rather than from whatever this process still
      // happened to be holding.
      self.clearance = self.clearance.filter { $0.key.accessoryId != accessoryId }
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
        "capabilities": (live?.capabilities.map { $0.toMap() }
          ?? Self.decodeCapabilities(row.capabilitiesJson))
          .map { self.describeCapability(row.accessoryId, $0) },
        // Derived from the frozen baseline rather than remembered in memory: a flag held only for
        // the life of the process would clear itself on the next launch, which is the one moment
        // the rider is least likely to be looking.
        "capabilitiesChanged": live.map {
          Self.encodeCapabilities($0.capabilities.map { $0.toMap() }) != row.capabilitiesJson
        } ?? false,
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

  /// One capability as JS sees it, with whatever this app has saved and decided about it.
  ///
  /// The saved calibration rides along with the capability rather than in a list of its own: it is
  /// keyed on the capability and meaningless without it, and a screen that had to join two arrays by
  /// id would be a place for them to disagree.
  ///
  /// `measuring` is the demand native actually resolved, not a restatement of what the screen asked
  /// for — a preview on a capability with no usable rate is a screen that is open and a sensor that
  /// is not measuring, and the row should say so.
  private func describeCapability(_ accessoryId: String, _ capability: [String: Any?]) -> [String:
    Any?]
  {
    guard let capabilityId = capability["id"] as? String,
      let state = clearance[CapabilityKey(accessoryId: accessoryId, capabilityId: capabilityId)]
    else { return capability }
    var out = capability
    out["calibration"] = state.calibration.map { saved -> [String: Any?] in
      [
        "nearCm": saved.nearCm,
        "farCm": saved.farCm,
        "direction": saved.direction,
        "strengthPercent": saved.strengthPercent,
        // Re-decided against the live manifest on every publish. A firmware that narrowed its range
        // turns a saved calibration into one that needs redoing, and the row says which rule it now
        // breaks.
        "problem": saved.problem(rangeMin: state.rangeMin, rangeMax: state.rangeMax)?.rawValue,
      ]
    }
    out["measuring"] = state.measurementDemanded
    return out
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
    let calibrations: [SavedGroundClearance]
    do {
      calibrations = try store.groundClearances()
    } catch {
      // The Accessories still connect. A calibration that could not be read is reported and treated
      // as absent, which shows the rider "not set up" rather than driving the board from numbers
      // this process never actually saw.
      RecordingStorageFailure.reportRead(operation: "accessory_ground_clearance", error: error)
      calibrations = []
    }
    saved.removeAll()
    order.removeAll()
    clearance.removeAll()
    for row in calibrations {
      runtime(row.accessoryId, row.capabilityId).calibration = GroundClearanceCalibration(
        nearCm: row.nearCm, farCm: row.farCm, direction: row.direction,
        strengthPercent: row.strengthPercent)
    }
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
    // `capabilitiesJson` is deliberately carried over unchanged. It is the baseline the rider's
    // saved settings were validated against, and the snapshot derives "limits changed" by comparing
    // the live manifest against it; rewriting it here would answer the question with the very thing
    // being questioned.
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
      // Update-only: a handshake completing just as the rider forgets this Accessory must not write
      // the row back.
      try store.revalidate(row)
    } catch {
      // The session is live and correct; only the saved copy of what the manifest just said is
      // stale, which the next successful handshake fixes.
      RecordingStorageFailure.report(
        operation: "accessory_revalidate", category: "write_failed", error: error)
    }
  }

  /// What every capability of one Accessory should currently be doing.
  ///
  /// The whole demand decision lives here and nowhere else. A ground-clearance capability measures
  /// when someone actually needs the numbers — the rider has its screen open, or the rider is on a
  /// calibrated board — and sits in the protocol's own measurement standby otherwise. Standby is not
  /// a pause in the app: `enabled: false` stops the sensor's continuous measurement on the accessory
  /// while BLE stays up, so leaving the screen genuinely stops measuring rather than throwing away
  /// samples the hardware is still burning power to produce.
  ///
  /// The brake light still gets #480's neutral baseline. It is the protocol's own unavailable state,
  /// and the slice that owns that capability replaces it with real telemetry.
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
            requested: Self.preferredRateHz, ratesHz: capability.ratesHz)
        else { continue }
        let state = runtime(row.accessoryId, capability.id)
        // Only a live manifest carries limits worth trusting. The decoded baseline is what the
        // Accessory said at enrollment, which is exactly the thing a changed firmware invalidates —
        // so the runtime keeps whatever the last handshake set rather than being reset to a stale
        // window by an offline re-apply.
        if manifest != nil {
          state.rangeMin = capability.rangeMin
          state.rangeMax = capability.rangeMax
        }
        state.riding = riding
        link.setDesired(
          .configure(
            capabilityId: capability.id, enabled: state.measurementDemanded, rateHz: rate))
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

  /// Re-decides demand for every enrolled Accessory, from whatever its session currently knows.
  private func reapplyDemand() {
    for (accessoryId, link) in links {
      guard let row = saved[accessoryId] else { continue }
      applyDemand(to: link, row: row, manifest: link.manifest)
    }
  }

  // MARK: - Ground clearance

  private func runtime(_ accessoryId: String, _ capabilityId: String) -> GroundClearanceRuntime {
    let key = CapabilityKey(accessoryId: accessoryId, capabilityId: capabilityId)
    if let existing = clearance[key] { return existing }
    let created = GroundClearanceRuntime(capabilityId: capabilityId)
    clearance[key] = created
    return created
  }

  /// The configuration screen for one capability opened or closed.
  ///
  /// The only demand JS is allowed to express, and it is a request to *measure*, never to tilt: a
  /// preview shows numbers on a parked board, and `groundClearanceInput` refuses to drive anything
  /// that is not being ridden regardless of what this says.
  ///
  /// A screen that is gone — backgrounded, unmounted, or its JS runtime killed — stops the sensor,
  /// which is what "leaving the screen stops measurements" means at the hardware.
  func setPreview(accessoryId: String, capabilityId: String, open: Bool) {
    onMain {
      let state = self.runtime(accessoryId, capabilityId)
      guard state.previewOpen != open else { return }
      state.previewOpen = open
      self.reapplyDemand()
      self.publish()
    }
  }

  /// Board engagement, from the Board Session's own predicate.
  ///
  /// Native's, never JS's: this decides whether a sensor runs while the screen is off, and a value
  /// that arrived over the bridge would stop being true the moment the runtime died.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySessionManager.kt `setRiding`
  func setRiding(_ riding: Bool) {
    onMain {
      // Compared before anything is re-applied. This arrives with every telemetry sample for the
      // whole of a ride, and re-deriving demand per sample to discover that nothing changed would
      // re-send the same command to every enrolled Accessory at telemetry rate.
      guard self.riding != riding else { return }
      self.riding = riding
      self.reapplyDemand()
      self.publish()
    }
  }

  /// Saves one calibration, if it is one.
  ///
  /// There is no Save button behind this: the screen sends what the rider has so far and native
  /// decides whether it is complete. Validity is judged against the limits the Accessory declares
  /// *now*, so a calibration is never written that the hardware in front of the rider would refuse.
  ///
  /// Saving a calibration that fits the current manifest is also how the rider accepts limits that
  /// moved since enrollment: the frozen `capabilitiesJson` baseline is rewritten to what the session
  /// just validated against, which is what clears "this Accessory now declares different limits".
  /// Nothing else in the app may rewrite that baseline.
  func saveGroundClearance(
    accessoryId: String, capabilityId: String, nearCm: Double, farCm: Double, direction: String,
    strengthPercent: Int, onResult: @escaping ([String: Any?]) -> Void
  ) {
    onMain {
      guard let row = self.saved[accessoryId] else {
        return onResult(["saved": false, "problem": "unknown-capability"])
      }
      let state = self.runtime(accessoryId, capabilityId)
      let candidate = GroundClearanceCalibration(
        nearCm: nearCm, farCm: farCm, direction: direction, strengthPercent: strengthPercent)
      if let problem = candidate.problem(rangeMin: state.rangeMin, rangeMax: state.rangeMax) {
        return onResult(["saved": false, "problem": problem.rawValue])
      }
      do {
        try self.store.saveGroundClearance(
          SavedGroundClearance(
            accessoryId: accessoryId, capabilityId: capabilityId, nearCm: nearCm, farCm: farCm,
            direction: direction, strengthPercent: strengthPercent,
            updatedAt: Int64(Date().timeIntervalSince1970 * 1000)))
      } catch {
        // Nothing is applied in memory either. A binding that drove from a calibration the database
        // never took would come back uncalibrated on the next launch, with the rider believing they
        // had set it.
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
          // The calibration is saved and correct; only the warning outlives the acceptance, and the
          // next save clears it.
          RecordingStorageFailure.report(
            operation: "accessory_revalidate", category: "write_failed", error: error)
        }
      }
      state.calibration = candidate
      self.reapplyDemand()
      self.publish()
      onResult(["saved": true, "problem": nil])
    }
  }

  /// Drops a calibration. The binding stops driving and the screen goes back to explaining setup.
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
      self.runtime(accessoryId, capabilityId).calibration = nil
      self.reapplyDemand()
      self.publish()
      onResult(removed)
    }
  }

  /// What a Remote Tilt binding may do with this capability right now. The seam #479 consumes.
  ///
  /// Two outcomes and no third: a scaled, signed input built from a fresh in-range measurement, or a
  /// named reason to release. Nothing here can be read as "hold the last value" — a consumer that
  /// gets a release has been told to let go, and why.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySessionManager.kt `groundClearanceInput`
  func groundClearanceInput(accessoryId: String, capabilityId: String) -> GroundClearanceInput {
    let key = CapabilityKey(accessoryId: accessoryId, capabilityId: capabilityId)
    guard let state = clearance[key] else { return .release(reason: .notCalibrated) }
    let link = links[accessoryId]
    state.rateHz = link?.appliedRateHz(capabilityId) ?? 0
    return state.input(
      nowMs: Int64(ProcessInfo.processInfo.systemUptime * 1000),
      linkConnected: link?.phase == .connected)
  }

  /// One sample off an Accessory's reading stream.
  ///
  /// Range-checked against the limits the *live* manifest declares before anything else sees it, so
  /// a number the hardware no longer promises is carried onward as `out_of_range` with no value
  /// rather than as a distance. A sample older than the newest one held is dropped outright.
  ///
  /// The bridge only hears about it while a screen is open. Nothing else in the app consumes single
  /// samples — the tilt binding pulls `groundClearanceInput` on its own cadence — so emitting at the
  /// sensor's rate with nothing mounted would be pure bridge traffic.
  private func onReading(
    _ accessoryId: String, _ reading: AccessoryReading, _ receivedAt: TimeInterval
  ) {
    let key = CapabilityKey(accessoryId: accessoryId, capabilityId: reading.capabilityId)
    guard let state = clearance[key] else { return }
    state.rateHz = links[accessoryId]?.appliedRateHz(reading.capabilityId) ?? state.rateHz
    let checked = reading.withinDeclaredRange(rangeMin: state.rangeMin, rangeMax: state.rangeMax)
    guard state.tracker.accept(checked, receivedAtMs: Int64(receivedAt * 1000)) else { return }
    guard state.previewOpen else { return }
    emit?(
      "onAccessoryReading",
      [
        "accessoryId": accessoryId,
        "capabilityId": checked.capabilityId,
        "seq": checked.seq,
        "sampleTimeMs": checked.sampleTimeMs,
        "status": checked.status.rawValue,
        "valueCm": checked.valueCm,
      ])
  }

  /// The protocol session for one Accessory ended.
  ///
  /// Sequence numbers restart with the next hello, so anything the tracker still holds would make
  /// the new session's first samples look like duplicates. The calibration is durable and stays.
  private func onSessionLost(_ accessoryId: String) {
    for (key, state) in clearance where key.accessoryId == accessoryId { state.onSessionLost() }
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
    // The links were created before the radio was usable and their first connect was refused. They
    // are already started, so `start` would decline them — this is the hook that resumes them.
    order.compactMap { saved[$0] }.forEach { start($0) }
    links.values.forEach { $0.onRadioAvailable() }
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
