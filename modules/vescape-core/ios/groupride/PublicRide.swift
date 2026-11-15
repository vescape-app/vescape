import Foundation

/// The rider's public ride switch: off, on until `until` (epoch ms), or on with no end (always).
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/PublicRide.kt `PublicRideSwitch`
internal struct PublicRideSwitch: Equatable {
  let on: Bool
  let until: Int64?

  func active(at now: Int64) -> Bool { on && (until.map { $0 > now } ?? true) }

  static let off = PublicRideSwitch(on: false, until: nil)
}

/// Public ride on the phone: the switch, its timer, when the rider goes public, and the public half
/// of the relay protocol (`public-on`/`public-off`/`public-position`, `nearby`, and the riders the
/// relay reports around the rider). Pure: the `GroupRideObserver` that owns the socket feeds it link
/// and relay events and hands it a `send` that only works while the link is open.
///
/// The rider rides public while the switch is active, a board is connected and an Account is signed
/// in. The relay turns an hours switch off at its end time by itself; the local timer only flips the
/// switch for the UI. Signing out or changing Account ends the public ride and turns the switch off.
///
/// Wire protocol: vescape-server `docs/group-ride/PROTOCOL.md`, "Public ride". Main thread only.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/PublicRide.kt
internal final class PublicRide {
  private let now: () -> Int64
  private let persist: (PublicRideSwitch) -> Void
  /// Arm the switch timer to fire `expire()` after the delay (ms); nil cancels it.
  private let scheduleExpiry: (Int64?) -> Void
  private let emit: (String, [String: Any?]) -> Void
  /// Send a frame on the open link; false when there is none.
  private let send: ([String: Any]) -> Bool

  private(set) var switchState = PublicRideSwitch.off
  private var boardConnected = false
  private var accountId: String?
  /// The link is up and has announced its features.
  private var linkReady = false
  private var supported = false
  /// `public-on` went out on this link and no `public-off` since.
  private var sentOn = false
  /// The relay confirmed this connection rides public.
  private var live = false
  /// Why the public ride last ended without the rider turning it off; cleared when it goes on.
  private var reason: String?
  /// The point watched with the switch off ("who is near me"); nil when not looking around.
  private var lookAround: (lat: Double, lng: Double)?
  private var riders: [(accountId: String, view: [String: Any?])] = []
  private var ridersNow: Int64?
  private var lastStatus: NSDictionary?

  init(
    now: @escaping () -> Int64,
    persist: @escaping (PublicRideSwitch) -> Void,
    scheduleExpiry: @escaping (Int64?) -> Void,
    emit: @escaping (String, [String: Any?]) -> Void,
    send: @escaping ([String: Any]) -> Bool
  ) {
    self.now = now
    self.persist = persist
    self.scheduleExpiry = scheduleExpiry
    self.emit = emit
    self.send = send
  }

  /// The rider should be public right now.
  var wanted: Bool { switchState.active(at: now()) && boardConnected && accountId != nil }

  /// Positions go out: the relay confirmed public riding on the open link.
  var riding: Bool { live && linkReady }

  /// The socket must stay up for the public ride or for looking around.
  var needsLink: Bool { wanted || lookAround != nil }

  /// Start from the persisted switch and the signed-in Account.
  func load(_ stored: PublicRideSwitch, accountId account: String?) {
    accountId = account
    switchState = account == nil || !stored.active(at: now()) ? .off : stored
    if switchState != stored { persist(switchState) }
    armTimer()
    emitStatus(force: true)
  }

  /// The rider moved the switch. Refused (false) without an Account or with an end time already
  /// past; off always works.
  @discardableResult
  func set(_ next: PublicRideSwitch) -> Bool {
    if next.on && (accountId == nil || !next.active(at: now())) { return false }
    let changed = next != switchState
    switchState = next
    if next.on { reason = nil }
    persist(next)
    armTimer()
    // A new end time must reach the relay: send `public-on` again with it.
    if changed && next.on && sentOn { sentOn = false }
    reconcile()
    emitStatus()
    return true
  }

  func setBoardConnected(_ connected: Bool) {
    guard connected != boardConnected else { return }
    boardConnected = connected
    reconcile()
    emitStatus()
  }

  /// The signed-in Account changed: sign-out, a rejected credential, or another Account. Ends the
  /// public ride at once and turns the switch off. Returns true when the Account changed, so the
  /// owner reconnects the socket under the new credential.
  @discardableResult
  func setAccount(_ account: String?) -> Bool {
    guard account != accountId else { return false }
    let hadAccount = accountId != nil
    // `public-off` goes out on the old connection, which still carries the old Account.
    if sentOn { _ = send(["type": "public-off"]) }
    sentOn = false
    live = false
    accountId = account
    if hadAccount && switchState.on {
      switchState = .off
      reason = Self.reasonSignedOut
      persist(switchState)
      armTimer()
    }
    emitStatus()
    return true
  }

  /// The switch timer fired.
  func expire() {
    guard switchState.on, !switchState.active(at: now()) else {
      armTimer()
      return
    }
    switchOff(Self.reasonEndTime)
  }

  /// The link opened and the relay listed its `features`.
  func linkReady(features: Set<String>) {
    linkReady = true
    supported = features.contains(Self.feature)
    sentOn = false
    live = false
    reconcile()
    if let lookAround { sendNearby(lookAround) }
    emitStatus()
  }

  /// The link is gone. Nothing is buffered: positions taken while it is down are dropped (#678
  /// keeps them for the reconnect). Watched riders are forgotten until the next `nearby-riders`.
  func linkLost() {
    linkReady = false
    sentOn = false
    live = false
    if !riders.isEmpty {
      riders = []
      emitRiders()
    }
    emitStatus()
  }

  /// A GPS fix, Privacy Zone gate already applied, taken at `at` (GPS time, epoch ms).
  func position(_ presence: RiderPresence, at: Int64) {
    // #678: unsent positions would be buffered here instead of dropped.
    guard riding else { return }
    _ = send(["type": "public-position", "at": at, "presence": presence.toJson()])
  }

  /// Watch public riders around `point` with the switch off.
  func watchNearby(_ point: (lat: Double, lng: Double)) {
    lookAround = point
    if linkReady { sendNearby(point) }
  }

  func stopWatchingNearby() {
    guard lookAround != nil else { return }
    lookAround = nil
    if linkReady { _ = send(["type": "nearby-stop"]) }
    // A public rider keeps receiving its own area.
    if !riding && !riders.isEmpty {
      riders = []
      emitRiders()
    }
  }

  /// Replay state to a JS runtime that just subscribed.
  func resync() {
    emitStatus(force: true)
    emitRiders()
  }

  /// A relay frame; true when it was a public ride one.
  @discardableResult
  func handle(type: String, json: [String: Any]) -> Bool {
    switch type {
    case "public-status":
      onStatus(json)
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
      emitRiders()
    case "public-rider-gone":
      let id = json["accountId"] as? String
      if let index = riders.firstIndex(where: { $0.accountId == id }) {
        riders.remove(at: index)
        emitRiders()
      }
    default:
      return false
    }
    return true
  }

  /// A relay `error`; true when it refused going public, which turns the switch off.
  @discardableResult
  func handleError(_ message: String) -> Bool {
    guard Self.refusals.contains(message) else { return false }
    sentOn = false
    live = false
    switchOff(Self.reasonRefused)
    return true
  }

  private func onStatus(_ json: [String: Any]) {
    if json["on"] as? Bool == true {
      live = true
      reason = nil
      emitStatus()
      return
    }
    live = false
    sentOn = false
    let why = (json["reason"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    switch why {
    // Another phone of this Account went public, or the relay reached the end time.
    case Self.reasonReplaced?, Self.reasonEndTime?:
      switchOff(why!)
    // Away too long: the relay dropped the rider; the switch still wants it, so go on again.
    default:
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
    reason = why
    persist(switchState)
    armTimer()
    emitStatus()
  }

  /// Bring the relay in line with `wanted`.
  private func reconcile() {
    guard linkReady, supported else { return }
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
      "on": switchState.on,
      "until": switchState.until,
      "live": riding,
      "supported": supported,
      "reason": reason,
    ]
    let comparable = status.mapValues { $0 ?? NSNull() } as NSDictionary
    if !force && comparable == lastStatus { return }
    lastStatus = comparable
    emit("onPublicRideStatus", status)
  }

  private func emitRiders() {
    emit("onPublicRiders", ["riders": riders.map { $0.view }, "now": ridersNow])
  }

  static let feature = "public-ride"
  static let reasonReplaced = "replaced"
  static let reasonEndTime = "end-time"
  static let reasonSignedOut = "signed-out"
  static let reasonRefused = "refused"
  private static let refusals: Set<String> = [
    "public ride needs an Account",
    "public ride needs a nick",
    "public ride end time already passed",
  ]

  /// A `PublicRiderView` as JS reads it; nil without an Account id.
  ///
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

/// Where the switch survives an app restart. Kept out of the settings table on purpose: a backup
/// restored on another phone must not make that phone public.
///
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
