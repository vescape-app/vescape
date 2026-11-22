import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/PublicRide.kt `PublicRideSwitch`
internal struct PublicRideSwitch: Equatable {
  let on: Bool
  let until: Int64?

  func active(at now: Int64) -> Bool { on && (until.map { $0 > now } ?? true) }

  static let off = PublicRideSwitch(on: false, until: nil)
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/PublicRide.kt
internal final class PublicRide {
  private enum Activation: String {
    case off, waiting, phone, board
  }

  private let now: () -> Int64
  private let persist: (PublicRideSwitch) -> Void
  private let scheduleExpiry: (Int64?) -> Void
  private let emit: (String, [String: Any?]) -> Void
  private let send: ([String: Any]) -> Bool
  private let scheduleMissedRetry: (Int64?) -> Void
  private let scheduleRidersFlush: (Int64?) -> Void
  private let onPublicRideDemandChanged: () -> Void
  private let onPins: ([SignalRider], [String: RideHazard], Int64?) -> Void
  private let onCue: (String) -> Void

  private(set) var switchState = PublicRideSwitch.off
  private var boardConnected = false
  private var manualSharing = false
  private var accountId: String?
  private var linkReady = false
  private var supported = false
  private var sentOn = false
  private var live = false
  private var reason: String?
  private var lookAround: (lat: Double, lng: Double)?
  private var riders: [(accountId: String, view: [String: Any?])] = []
  private var ridersNow: Int64?
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/PublicRide.kt `ridersPending`
  private var ridersPending = false
  private var lastStatus: NSDictionary?
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/PublicRide.kt `pendingPins`
  private var pendingPins: [PinSlot: RiderPinIntent] = [:]
  private var ownPins: [PinSlot: [String: Any?]] = [:]
  private var confirmedOwnSignal: RiderSignal?
  private var announcedSignals: [String: RiderSignal] = [:]
  private var pins: [(accountId: String, pins: PublicPins)] = []
  private var pinsNow: Int64?
  private var pinsReceivedAt: Int64 = 0
  private var missedSupported = false
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/PublicRide.kt `missed`
  private var missed: [(atMs: Int64, presence: RiderPresence)] = []
  private var missedInFlight = 0
  private var authenticatedAccount: String?
  private var lastNeedsLink = false
  private var lastNeedsGps = false

  init(
    now: @escaping () -> Int64,
    persist: @escaping (PublicRideSwitch) -> Void,
    scheduleExpiry: @escaping (Int64?) -> Void,
    emit: @escaping (String, [String: Any?]) -> Void,
    send: @escaping ([String: Any]) -> Bool,
    scheduleMissedRetry: @escaping (Int64?) -> Void = { _ in },
    scheduleRidersFlush: @escaping (Int64?) -> Void = { _ in },
    onPublicRideDemandChanged: @escaping () -> Void = {},
    onPins: @escaping ([SignalRider], [String: RideHazard], Int64?) -> Void = { _, _, _ in },
    onCue: @escaping (String) -> Void = { _ in }
  ) {
    self.now = now
    self.persist = persist
    self.scheduleExpiry = scheduleExpiry
    self.emit = emit
    self.send = send
    self.onPins = onPins
    self.onCue = onCue
    self.scheduleMissedRetry = scheduleMissedRetry
    self.scheduleRidersFlush = scheduleRidersFlush
    self.onPublicRideDemandChanged = onPublicRideDemandChanged
  }

  private var activation: Activation {
    guard accountId != nil, switchState.active(at: now()) else { return .off }
    if boardConnected { return .board }
    return manualSharing ? .phone : .waiting
  }

  var wanted: Bool {
    let activation = self.activation
    return activation == .board || activation == .phone
  }

  var needsGps: Bool { activation == .phone }

  var riding: Bool { wanted && live && linkReady }

  var canPin: Bool { wanted && supported }

  var needsLink: Bool { wanted || lookAround != nil || !missed.isEmpty }

  func load(_ stored: PublicRideSwitch, accountId account: String?) {
    accountId = account
    manualSharing = false
    switchState = account == nil || !stored.active(at: now()) ? .off : stored
    if switchState != stored { persist(switchState) }
    armTimer()
    emitStatus(force: true)
  }

  @discardableResult
  func set(_ next: PublicRideSwitch) -> Bool {
    if next.on && (accountId == nil || !next.active(at: now())) { return false }
    let changed = next != switchState
    switchState = next
    if !next.on { manualSharing = false }
    if next.on { reason = nil }
    persist(next)
    armTimer()
    if changed && next.on && sentOn { sentOn = false }
    reconcile()
    emitStatus()
    return true
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/PublicRide.kt `setManualSharing`
  func setManualSharing(_ enabled: Bool) {
    guard !boardConnected, activation != .off, manualSharing != enabled else { return }
    manualSharing = enabled
    if enabled { reason = nil }
    reconcile()
    emitStatus()
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/PublicRide.kt `setBoardConnected`
  func setBoardConnected(_ connected: Bool) {
    guard connected != boardConnected else { return }
    boardConnected = connected
    if connected { manualSharing = false }
    reconcile()
    emitStatus()
  }

  @discardableResult
  func setAccount(_ account: String?) -> Bool {
    guard account != accountId else { return false }
    let hadAccount = accountId != nil
    if sentOn { _ = send(["type": "public-off"]) }
    sentOn = false
    live = false
    accountId = account
    manualSharing = false
    linkReady = false
    authenticatedAccount = nil
    dropOwnPins()
    announcedSignals = [:]
    resetReceived()
    discardMissed()
    if hadAccount && switchState.on {
      switchState = .off
      reason = Self.reasonSignedOut
      persist(switchState)
      armTimer()
    }
    emitStatus()
    return true
  }

  func expire() {
    guard switchState.on, !switchState.active(at: now()) else {
      armTimer()
      return
    }
    switchOff(Self.reasonEndTime)
  }

  func linkReady(features: Set<String>, authenticatedAccount: String?) {
    self.authenticatedAccount = authenticatedAccount
    linkReady = true
    supported = features.contains(Self.feature)
    missedSupported = features.contains(Self.missedPositionsFeature)
    missedInFlight = 0
    if !missedSupported { discardMissed() }
    sentOn = false
    live = false
    sendMissed()
    reconcile()
    if let lookAround { sendNearby(lookAround) }
    emitStatus()
  }

  func linkLost() {
    linkReady = false
    authenticatedAccount = nil
    scheduleMissedRetry(nil)
    missedInFlight = 0
    sentOn = false
    live = false
    resetReceived()
    emitStatus()
  }

  func position(_ presence: RiderPresence, atMs: Int64) {
    guard wanted else { return }
    guard riding else {
      keepMissed(presence, atMs: atMs)
      return
    }
    sendMissed()
    _ = send(["type": "public-position", "at": atMs, "presence": presence.toJson()])
  }

  func watchNearby(_ point: (lat: Double, lng: Double)) {
    lookAround = point
    emitDemand()
    if linkReady { sendNearby(point) }
  }

  func followNearby(_ point: (lat: Double, lng: Double)) {
    guard let current = lookAround else { return watchNearby(point) }
    let moved = GeoMath.distanceMeters(current.lat, current.lng, point.lat, point.lng)
    guard moved >= Self.lookAroundRecentreM else { return }
    lookAround = point
    if linkReady && !riding { sendNearby(point) }
  }

  func stopWatchingNearby() {
    guard lookAround != nil else { return }
    lookAround = nil
    emitDemand()
    if linkReady { _ = send(["type": "nearby-stop"]) }
    if !riding && !riders.isEmpty {
      riders = []
      emitRiders()
    }
  }

  @discardableResult
  func submitPin(_ intent: RiderPinIntent) -> Bool {
    guard canPin else { return false }
    switch intent {
    case let .send(slot, kind, lat, lng):
      let startedAt = relayNow()
      ownPins[slot] = [
        "kind": kind,
        "lat": lat,
        "lng": lng,
        "startedAt": startedAt,
        "expiresAt": startedAt + Self.pinLifetimeMs,
      ]
    case let .clear(slot):
      ownPins[slot] = nil
    }
    pendingPins[intent.slot] = intent
    sendPendingPins()
    emitPins()
    return true
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/PublicRide.kt `nearbyRoster`
  var nearbyRoster: GroupRideRoster? {
    guard riding else { return nil }
    let rows = riders.compactMap { entry -> GroupRideRosterRider? in
      var view = entry.view
      view["id"] = entry.accountId
      view["name"] = entry.view["nick"] ?? nil
      return GroupRideObserver.rosterRider(view)
    }
    return GroupRideRoster(ownRiderId: accountId, riders: rows)
  }

  func resync() {
    emitStatus(force: true)
    emitRiders()
    emitPins()
  }

  @discardableResult
  func handle(type: String, json: [String: Any]) -> Bool {
    switch type {
    case "public-status":
      onStatus(json)
    case "missed-stored":
      missed.removeFirst(min(missedInFlight, missed.count))
      missedInFlight = 0
      scheduleMissedRetry(nil)
      sendMissed()
      emitDemand()
    case "nearby-riders":
      riders = (json["riders"] as? [Any] ?? []).compactMap { entry in
        Self.publicRiderView(entry as? [String: Any]).map { (accountId: $0["accountId"] as! String, view: $0) }
      }
      ridersNow = (json["now"] as? NSNumber)?.int64Value
      emitRiders()
    case "public-rider":
      guard let view = Self.publicRiderView(json["rider"] as? [String: Any]),
            let id = view["accountId"] as? String
      else { return true }
      if let index = riders.firstIndex(where: { $0.accountId == id }) {
        riders[index].view = view
      } else {
        riders.append((accountId: id, view: view))
      }
      ridersNow = (json["now"] as? NSNumber)?.int64Value
      if !ridersPending {
        ridersPending = true
        scheduleRidersFlush(Self.ridersBatchMs)
      }
    case "public-rider-gone":
      let id = json["accountId"] as? String
      if let index = riders.firstIndex(where: { $0.accountId == id }) {
        riders.remove(at: index)
        emitRiders()
      }
    case "public-pins":
      guard let id = json["accountId"] as? String, !id.isEmpty else { return true }
      let signal = RiderSignal.parse(json["signal"] as? [String: Any])
      let relayTime = (json["now"] as? NSNumber)?.int64Value
      if id == accountId {
        if riding, let relayTime { confirmOwnSignal(signal, atMs: relayTime) }
        return true
      }
      let hazard = RideHazard.parse(json["hazard"] as? [String: Any])
      let entry = PublicPins(nick: json["nick"] as? String ?? "", signal: signal, hazard: hazard)
      let index = pins.firstIndex(where: { $0.accountId == id })
      let previous = index.flatMap { pins[$0].pins.signal }
      if let index {
        if signal == nil && hazard == nil { pins.remove(at: index) } else { pins[index].pins = entry }
      } else if signal != nil || hazard != nil {
        pins.append((accountId: id, pins: entry))
      }
      if let relayTime {
        pinsNow = relayTime
        pinsReceivedAt = self.now()
        announcePeerSignal(
          signal, riderId: id, previous: previous,
          clearedStartedAt: (json["clearedSignalStartedAt"] as? NSNumber)?.int64Value, atMs: relayTime
        )
      }
      emitPins()
      onPins(
        pins.map { SignalRider(id: $0.accountId, name: $0.pins.nick, signal: $0.pins.signal) },
        Dictionary(uniqueKeysWithValues: pins.compactMap { entry in entry.pins.hazard.map { (entry.accountId, $0) } }),
        pinsNow
      )
    default:
      return false
    }
    return true
  }

  private func confirmOwnSignal(_ signal: RiderSignal?, atMs relayTime: Int64) {
    let previous = confirmedOwnSignal
    confirmedOwnSignal = signal
    if let signal, ownPins[.signal] != nil, signal.expiresAt > relayTime, signal.startedAt != previous?.startedAt {
      onCue("groupRide.signal.sent")
    } else if signal == nil, ownPins[.signal] == nil, let previous, previous.expiresAt > relayTime {
      onCue("groupRide.signal.cleared")
    }
  }

  private func announcePeerSignal(
    _ signal: RiderSignal?, riderId: String, previous: RiderSignal?, clearedStartedAt: Int64?, atMs relayTime: Int64
  ) {
    announcedSignals = announcedSignals.filter { $0.value.expiresAt > relayTime }
    if let signal, signal.expiresAt > relayTime,
       announcedSignals[riderId].map({ $0.startedAt < signal.startedAt }) ?? true {
      announcedSignals[riderId] = signal
      onCue("groupRide.signal." + signal.kind.rawValue)
    } else if signal == nil, let previous, previous.startedAt == clearedStartedAt {
      onCue("groupRide.signal.ok")
    }
  }

  @discardableResult
  func handleError(_ message: String) -> Bool {
    if message == Self.missedNotStored {
      return false
    }
    let why: String
    switch message {
    case Self.connectionReplaced: why = Self.reasonReplaced
    case _ where Self.refusals.contains(message): why = Self.reasonRefused
    default: return false
    }
    sentOn = false
    live = false
    switchOff(why)
    return true
  }

  private func onStatus(_ json: [String: Any]) {
    if json["on"] as? Bool == true {
      live = true
      reason = nil
      sendPendingPins()
      sendMissed()
      emitStatus()
      return
    }
    live = false
    sentOn = false
    let why = (json["reason"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    switch why {
    case Self.reasonReplaced?, Self.reasonEndTime?:
      switchOff(why!)
    default:
      dropOwnPins()
      if let why { reason = why }
      reconcile()
      emitStatus()
    }
  }

  private func switchOff(_ why: String) {
    if sentOn { _ = send(["type": "public-off"]) }
    sentOn = false
    live = false
    switchState = .off
    manualSharing = false
    reason = why
    persist(switchState)
    armTimer()
    dropOwnPins()
    emitStatus()
  }

  private func reconcile() {
    if !wanted { dropOwnPins() }
    guard linkReady, supported, accountId != nil, authenticatedAccount == accountId else { return }
    if wanted && !sentOn {
      var frame: [String: Any] = ["type": "public-on"]
      if let until = switchState.until { frame["until"] = until }
      sentOn = send(frame)
    } else if !wanted && sentOn {
      _ = send(["type": "public-off"])
      sentOn = false
      live = false
    }
  }

  private func sendPendingPins() {
    guard riding else { return }
    for intent in pendingPins.values where send(intent.frame(prefix: Self.publicPrefix)) {
      pendingPins[intent.slot] = nil
    }
  }

  private func keepMissed(_ presence: RiderPresence, atMs: Int64) {
    guard wanted, !linkReady || missedSupported else { return }
    if let last = missed.last?.atMs, atMs - last < Self.missedSpacingMs { return }
    missed.append((atMs, presence))
    while missed.count > missedInFlight,
          atMs - missed[missedInFlight].atMs > Self.missedMaxAgeMs || missed.count > Int(Self.missedMaxAgeMs / Self.missedSpacingMs) + 1 {
      missed.remove(at: missedInFlight)
    }
    emitDemand()
  }

  private func sendMissed() {
    guard linkReady, accountId != nil, authenticatedAccount == accountId, missedSupported, missedInFlight == 0, !missed.isEmpty else { return }
    let batch = missed.prefix(Self.missedBatchMax)
    let positions: [[String: Any]] = batch.map { ["at": $0.atMs, "presence": $0.presence.toJson()] }
    if send(["type": "missed-positions", "positions": positions]) {
      missedInFlight = batch.count
      scheduleMissedRetry(Self.missedRetryMs)
    }
  }

  func discardMissed() {
    missed = []
    missedInFlight = 0
    scheduleMissedRetry(nil)
    emitDemand()
  }

  private func emitDemand() {
    let needed = needsLink
    let gpsNeeded = needsGps
    guard needed != lastNeedsLink || gpsNeeded != lastNeedsGps else { return }
    lastNeedsLink = needed
    lastNeedsGps = gpsNeeded
    onPublicRideDemandChanged()
  }

  private func resetReceived() {
    riders = []
    ridersNow = nil
    emitRiders()
    pins = []
    pinsNow = nil
    pinsReceivedAt = 0
    emitPins()
    onPins([], [:], nil)
  }

  private func dropOwnPins() {
    pendingPins = [:]
    confirmedOwnSignal = nil
    guard !ownPins.isEmpty else { return }
    ownPins = [:]
    emitPins()
  }

  func relayNow() -> Int64 { pinsNow.map { $0 + now() - pinsReceivedAt } ?? now() }

  private func sendNearby(_ point: (lat: Double, lng: Double)) {
    _ = send(["type": "nearby", "lat": point.lat, "lng": point.lng])
  }

  private func armTimer() {
    if switchState.on, let until = switchState.until {
      scheduleExpiry(max(until - now(), 0))
    } else {
      scheduleExpiry(nil)
    }
  }

  /// @parity /modules/vescape-core/src/index.ts `PublicRideStatus`
  private func emitStatus(force: Bool = false) {
    let status: [String: Any?] = [
      "activation": activation.rawValue,
      "until": switchState.until,
      "live": riding,
      "supported": supported,
      "reason": reason,
    ]
    let comparable = status.mapValues { $0 ?? NSNull() } as NSDictionary
    emitDemand()
    if !force && comparable == lastStatus { return }
    lastStatus = comparable
    emit("onPublicRideStatus", status)
  }

  func flushRiders() {
    if ridersPending { emitRiders() }
  }

  private func emitRiders() {
    if ridersPending {
      ridersPending = false
      scheduleRidersFlush(nil)
    }
    emit("onPublicRiders", ["riders": riders.map { $0.view }, "now": ridersNow])
  }

  /// @parity /modules/vescape-core/src/index.ts `PublicPinsEvent`
  private func emitPins() {
    emit("onPublicPins", [
      "pins": pins.map { entry -> [String: Any?] in
        ["accountId": entry.accountId, "nick": entry.pins.nick, "signal": entry.pins.signal?.toMap(), "hazard": entry.pins.hazard?.toMap()]
      },
      "own": ["signal": ownPins[.signal] ?? nil, "hazard": ownPins[.hazard] ?? nil] as [String: Any?],
      "now": relayNow(),
    ])
  }

  static let feature = "public-ride"
  static let missedPositionsFeature = "missed-positions"
  static let lookAroundRecentreM = 1_000.0
  static let missedRetryMs: Int64 = 10_000
  static let ridersBatchMs: Int64 = 250
  static let missedSpacingMs: Int64 = 5_000
  static let missedMaxAgeMs: Int64 = 3 * 60 * 60_000
  static let missedBatchMax = 500
  static let missedNotStored = "missed positions not stored"
  static let connectionReplaced = "connection replaced"
  static let publicPrefix = "public-"
  static let pinLifetimeMs: Int64 = 90 * 60_000
  static let reasonReplaced = "replaced"
  static let reasonEndTime = "end-time"
  static let reasonSignedOut = "signed-out"
  static let reasonRefused = "refused"
  private static let refusals: Set<String> = [
    "public ride needs an Account",
    "public ride needs a nick",
    "public ride end time already passed",
  ]

  /// @parity /modules/vescape-core/src/index.ts `PublicRider`
  static func publicRiderView(_ obj: [String: Any]?) -> [String: Any?]? {
    guard let obj, let accountId = obj["accountId"] as? String, !accountId.isEmpty else { return nil }
    return [
      "accountId": accountId,
      "nick": obj["nick"] as? String ?? "",
      "presence": GroupRideObserver.presenceMap(obj["presence"] as? [String: Any]),
      "trail": GroupRideObserver.trailList(obj["trail"] as? [Any]),
      "stale": obj["stale"] as? Bool ?? false,
      "away": obj["away"] as? Bool ?? false,
      "lastSeen": (obj["lastSeen"] as? NSNumber)?.int64Value ?? 0,
    ]
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/PublicRide.kt `PublicPins`
internal struct PublicPins {
  let nick: String
  let signal: RiderSignal?
  let hazard: RideHazard?
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/PublicRide.kt `PublicRideStore`
internal struct PublicRideStore {
  var defaults: UserDefaults = .standard

  func read() -> PublicRideSwitch {
    guard defaults.bool(forKey: Self.onKey) else { return .off }
    let until = (defaults.object(forKey: Self.untilKey) as? NSNumber)?.int64Value
    return PublicRideSwitch(on: true, until: until)
  }

  func write(_ value: PublicRideSwitch) {
    defaults.set(value.on, forKey: Self.onKey)
    if let until = value.until {
      defaults.set(NSNumber(value: until), forKey: Self.untilKey)
    } else {
      defaults.removeObject(forKey: Self.untilKey)
    }
  }

  private static let onKey = "vescape.publicRide.on"
  private static let untilKey = "vescape.publicRide.until"
}
