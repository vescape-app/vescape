import Foundation

/// Group Ride **observe** client: a native WebSocket to the relay server that surfaces
/// ride-lifecycle events to JS. Observing sends NOTHING — it only receives the active-ride
/// `snapshot` on connect, then `ride-created` / `ride-updated` / `ride-ended` deltas (global
/// fan-out). Location leaves the device only when creating/joining, never while observing.
///
/// Wire protocol: vescape-server `docs/group-ride/PROTOCOL.md`. All state is touched on the main
/// thread; URLSession callbacks hop back onto it before mutating anything.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/GroupRideObserver.kt
/// @platform-diff Android hosts the socket in its foreground service; iOS has no such process, so
/// the observer lives on `BoardSessionController` and rides the app's BLE/`location` background
/// modes — a backgrounded iPhone with neither active drops the connection until it returns.
internal final class GroupRideObserver: NSObject {
  private let emit: (String, [String: Any?]) -> Void
  private let online: OnlineCapability
  private let scheduler: Scheduler

  private lazy var session = URLSession(
    configuration: .default,
    delegate: self,
    delegateQueue: nil
  )

  private var webSocket: GroupRideSocket?
  private var serverUrl: String?
  private var reconnectAttempt = 0
  private var stopped = true
  private var riderId: String?
  private var riderName: String?
  private var signalNotices = RiderSignalNotices()
  private var hazardCues = RideHazardCues()
  private var relayFeatures: Set<String> = []
  private var lastSignalAvailability: [String: Bool]?
  private var lastConnection = "idle"
  private var onlineUnsub: (() -> Void)?
  private var reconnectWork: Cancellable?
  private var heartbeatWork: Cancellable?
  private var pingWork: Cancellable?


  private let onCue: (String) -> Void
  private let ownLocation: () -> (lat: Double, lng: Double)?
  private let signalContext: () -> RiderSignalContext
  private let makeSocket: ((URLRequest) -> GroupRideSocket)?
  private let deviceToken: () -> String?
  private let lastKnownLocation: () -> (lat: Double, lng: Double)?
  private var expiryWork: Cancellable?

  private var publicRide: PublicRide!

  init(
    emit: @escaping (String, [String: Any?]) -> Void,
    online: OnlineCapability,
    scheduler: Scheduler = MainQueueScheduler(),
    onCue: @escaping (String) -> Void = { _ in },
    ownLocation: @escaping () -> (lat: Double, lng: Double)? = { nil },
    signalContext: @escaping () -> RiderSignalContext = { RiderSignalContext(fix: nil, insidePrivacyZone: true) },
    deviceToken: @escaping () -> String? = { nil },
    persistPublicRide: @escaping (PublicRideSwitch) -> Void = { _ in },
    lastKnownLocation: @escaping () -> (lat: Double, lng: Double)? = { nil },
    now: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) },
    makeSocket: ((URLRequest) -> GroupRideSocket)? = nil
  ) {
    self.deviceToken = deviceToken
    self.lastKnownLocation = lastKnownLocation
    self.signalContext = signalContext
    self.makeSocket = makeSocket
    self.onCue = onCue
    self.ownLocation = ownLocation
    self.emit = emit
    self.online = online
    self.scheduler = scheduler
    super.init()
    publicRide = PublicRide(
      now: now,
      persist: persistPublicRide,
      scheduleExpiry: { [weak self] delay in
        guard let self else { return }
        self.expiryWork?.cancel()
        self.expiryWork = delay.map { delay in
          scheduler.postDelayed(delay) { [weak self] in self?.publicRide.expire() }
        }
      },
      emit: { [weak self] name, payload in
        emit(name, payload)
        // Going public or off it changes whether a pin can be sent.
        if name == "onPublicRideStatus" { self?.refreshSignalAvailability() }
      },
      send: { [weak self] frame in
        guard let self, self.linkOpen, let ws = self.webSocket else { return false }
        self.send(ws, frame)
        return true
      },
      onPins: { [weak self] signals, hazards, relayNow in
        self?.onPublicPins(signals, hazards: hazards, relayNow: relayNow)
      }
    )
  }

  var active: Bool { !stopped }

  var publicRideNeedsLink: Bool { publicRide.needsLink }




  var watchRoster: GroupRideRoster? { stopped ? nil : publicRide.nearbyRoster }


  func start(_ url: String) {
    // The observer outlives the JS runtime, so a relaunch re-subscribes to a socket that will emit
    // nothing on its own. Replay instead of returning silently, or JS renders `idle`/OFFLINE over a
    // live connection.
    if !stopped && url == serverUrl {
      resync()
      return
    }
    stopped = false
    serverUrl = url
    reconnectAttempt = 0
    onlineUnsub?()
    // The gate can outlive the JS runtime, so the observe socket reacts to App Status changes
    // directly rather than through JS — tearing down on a block, resuming when it clears.
    onlineUnsub = online.addListener { [weak self] in self?.onOnlineChanged() }
    connect()
    // A fresh JS runtime learns the switch even before the relay answers.
    publicRide.resync()
  }

  func stop() {
    stopped = true
    cancelReconnect()
    onlineUnsub?()
    onlineUnsub = nil
    webSocket?.close()
    webSocket = nil
    relayFeatures = []
    // A restarted observer must re-emit availability to the fresh JS store.
    lastSignalAvailability = nil
    stopHeartbeat()
    stopPing()
    publicRide.linkLost()
    emitConnection("idle")
  }

  private func resync() {
    emitConnection(lastConnection)
    lastSignalAvailability = nil
    refreshSignalAvailability()
    publicRide.resync()
  }

  private func onOnlineChanged() {
    if stopped { return }
    if online.onlineBlocked {
      tearDownForBlock()
    } else if webSocket == nil {
      // Block cleared while observing with no socket (torn down by an earlier block, or refused at
      // start): resume. A change arriving while connected leaves the live socket alone.
      connect()
    }
  }

  private func tearDownForBlock() {
    cancelReconnect()
    webSocket?.close()
    webSocket = nil
    reconnectAttempt = 0
    stopHeartbeat()
    stopPing()
    publicRide.linkLost()
    emitConnection("blocked")
  }

  private var linkOpen: Bool { webSocket != nil && lastConnection == "connected" }

  private func isCurrentSocket(_ task: GroupRideSocket) -> Bool {
    !stopped && !online.onlineBlocked && webSocket === task
  }







  func updateIdentity(riderId: String, riderName: String) {
    onMain { [self] in
      self.riderId = riderId
      self.riderName = riderName
      guard !stopped, let ws = webSocket else { return }
      sendHello(ws, riderId: riderId, riderName: riderName)
    }
  }

  func sendSignal(_ kind: String) {
    sendPin(kind, RiderSignalKind(rawValue: kind))
  }

  func sendHazard(_ kind: String) {
    sendPin(kind, RideHazardKind(rawValue: kind))
  }

  private func sendPin<Kind: PinKind>(_ wire: String, _ kind: Kind?) {
    onMain { [self] in
      guard let kind, let intent = RiderSignals.sendIntent(kind, signalContext()) else {
        NSLog("[GroupRide] pin rejected: kind=\(wire), unknown kind or no recent fix")
        return
      }
      submitPin(intent)
    }
  }

  func clearSignal() {
    onMain { [self] in submitPin(.clear(.signal)) }
  }

  func clearHazard() {
    onMain { [self] in submitPin(.clear(.hazard)) }
  }

  func refreshSignalAvailability() {
    onMain { [self] in
      guard !stopped else { return }
      let context = signalContext()
      // In a ride its relay features decide; outside one, the public ride.
      let isPublic = publicRide.canPin
      let availability = [
        "supported": isPublic,
        "hazardsSupported": isPublic,
        "insidePrivacyZone": context.insidePrivacyZone,
        "hasRecentFix": context.fix != nil,
      ]
      guard availability != lastSignalAvailability else { return }
      lastSignalAvailability = availability
      emit("onGroupRideSignalAvailability", availability)
    }
  }

  func onFix(lat: Double, lng: Double) {
    onMain { [self] in
      guard !stopped, let cue = hazardCues.fix(lat: lat, lng: lng) else { return }
      onCue(cue)
    }
  }



  private func submitPin(_ intent: RiderPinIntent) {
    guard !stopped else { return }
    _ = publicRide.submitPin(intent)
  }

  func pushPresence(_ presence: RiderPresence) {
    onMain { [self] in
      guard !stopped else { return }
      if let at = presence.at { publicRide.position(presence, at: at) }
    }
  }

  func loadPublicRide(_ stored: PublicRideSwitch, accountId: String?) {
    onMain { [self] in publicRide.load(stored, accountId: accountId) }
  }

  func setPublicRide(_ next: PublicRideSwitch) {
    onMain { [self] in
      if !publicRide.set(next) { publicRide.resync() }
    }
  }

  func setBoardConnected(_ connected: Bool) {
    onMain { [self] in publicRide.setBoardConnected(connected) }
  }

  func setAccount(_ accountId: String?) {
    onMain { [self] in
      guard publicRide.setAccount(accountId), !stopped, let ws = webSocket else { return }
      webSocket = nil
      ws.close()
      reconnectAttempt = 0
      scheduleReconnect()
    }
  }

  func watchPublicRiders() {
    onMain { [self] in
      guard let point = ownLocation() ?? lastKnownLocation() else {
        NSLog("[GroupRide] look-around ignored: no known position")
        return
      }
      publicRide.watchNearby(point)
    }
  }

  func stopWatchingPublicRiders() {
    onMain { [self] in publicRide.stopWatchingNearby() }
  }

  private func connect() {
    guard let url = serverUrl, !stopped else { return }
    // Native owns the gate: refuse the upgrade (fresh start or scheduled reconnect) while online
    // work is blocked, surfacing `blocked` instead of hammering the relay.
    if online.onlineBlocked {
      emitConnection("blocked")
      return
    }
    guard let request = GroupRideOnlineGate.buildObserveRequest(
      url: url, appVersion: online.appVersion, deviceToken: deviceToken()
    ) else {
      NSLog("[GroupRide] observe URL is not usable: \(url)")
      return
    }
    emitConnection("connecting")
    let task = makeSocket?(request) ?? session.webSocketTask(with: request)
    webSocket = task
    task.open()
    receive(on: task)
    schedulePing()
  }

  private func receive(on task: GroupRideSocket) {
    task.receiveText { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let text):
        self.onMain {
          guard self.isCurrentSocket(task) else { return }
          if let text { self.handleMessage(text) }
        }
        self.receive(on: task)
      case .failure:
        break
      }
    }
  }

  func onOpen(_ task: GroupRideSocket) {
    onMain { [self] in
      guard isCurrentSocket(task) else { return }
      reconnectAttempt = 0
      emitConnection("connected")
      guard let id = riderId, let name = riderName else { return }
      sendHello(task, riderId: id, riderName: name)
    }
  }

  func onClosed(_ task: GroupRideSocket, responseCode: Int?) {
    onMain { [self] in
      guard isCurrentSocket(task) else { return }
      if responseCode == GroupRideOnlineGate.versionRejectionCode {
        // Server refused the upgrade for this app version — refresh App Status so the gate learns
        // the block, and surface `blocked` rather than reconnect-looping.
        online.refresh()
        tearDownForBlock()
        return
      }
      scheduleReconnect()
    }
  }

  private func scheduleReconnect() {
    webSocket = nil
    stopPing()
    if stopped { return }
    stopHeartbeat()
    publicRide.linkLost()
    emitConnection("disconnected")
    let delay = Self.reconnectDelaysSeconds[min(reconnectAttempt, Self.reconnectDelaysSeconds.count - 1)]
    reconnectAttempt += 1
    reconnectWork = scheduler.postDelayed(Int64(delay * 1000)) { [weak self] in self?.connect() }
  }

  private func cancelReconnect() {
    reconnectWork?.cancel()
    reconnectWork = nil
  }

  private func handleMessage(_ text: String) {
    guard let data = text.data(using: .utf8),
          // intentional-suppression: malformed inbound frames are logged and discarded
          let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else {
      NSLog("[GroupRide] Discarding malformed Group Ride frame")
      return
    }
    switch json["type"] as? String {
    case "snapshot":
      relayFeatures = Set((json["features"] as? [Any] ?? []).compactMap { $0 as? String })
      refreshSignalAvailability()
      publicRide.linkReady(features: relayFeatures)
    case "error":
      if let message = json["message"] as? String, !message.isEmpty {
        publicRide.handleError(message)
        emit("onGroupRideError", ["message": message])
      }
    case let type?:
      if publicRide.handle(type: type, json: json) && publicRide.riding { startHeartbeat() }
    default:
      break
    }
  }



  private func sendHello(_ task: GroupRideSocket, riderId: String, riderName: String) {
    self.riderId = riderId
    self.riderName = riderName
    send(task, ["type": "hello", "riderId": riderId, "name": riderName])
  }



  private func send(_ task: GroupRideSocket, _ frame: [String: Any], onFailure: (() -> Void)? = nil) {
    let text: String
    do {
      let data = try JSONSerialization.data(withJSONObject: frame)
      guard let encoded = String(data: data, encoding: .utf8) else {
        throw CocoaError(.fileReadInapplicableStringEncoding)
      }
      text = encoded
    } catch {
      UnexpectedNativeError.report(operation: "group_ride_frame_encode", category: "encode_failed", error: error)
      return
    }
    task.sendText(text) { [weak self] error in
      guard let error, let self else { return }
      self.onMain {
        onFailure?()
        guard self.isCurrentSocket(task) else { return }
        NSLog("[GroupRide] send failed: \(error.localizedDescription)")
        self.scheduleReconnect()
      }
    }
  }



  private func riderView(_ obj: [String: Any]?, signal: RiderSignal?, hazard: RideHazard?) -> [String: Any?]? {
    guard let obj, let id = obj["id"] as? String, !id.isEmpty else { return nil }
    return [
      "id": id,
      "name": obj["name"] as? String ?? "",
      "presence": Self.presenceMap(obj["presence"] as? [String: Any]),
      "trail": Self.trailList(obj["trail"] as? [Any]),
      "stale": obj["stale"] as? Bool ?? false,
      // The relay keeps a Rider whose socket closed as `away`; older relays omit it.
      "away": obj["away"] as? Bool ?? false,
      "lastSeen": (obj["lastSeen"] as? NSNumber)?.int64Value ?? 0,
      "signal": signal?.toMap(),
      "hazard": hazard?.toMap(),
    ]
  }

  static func trailList(_ arr: [Any]?) -> [[String: Any?]]? {
    guard let arr else { return nil }
    return arr.compactMap { entry in
      guard let point = entry as? [String: Any] else { return nil }
      return ["lat": point.double("lat") ?? 0, "lng": point.double("lng") ?? 0]
    }
  }

  static func presenceMap(_ obj: [String: Any]?) -> [String: Any?]? {
    guard let obj,
      let lat = obj.double("lat"), lat.isFinite,
      let lng = obj.double("lng"), lng.isFinite
    else { return nil }
    return [
      "lat": lat,
      "lng": lng,
      "heading": obj.double("heading"),
      "speed": obj.double("speed"),
      "soc": obj.double("soc"),
      "motorTemp": obj.double("motorTemp"),
      "ctrlTemp": obj.double("ctrlTemp"),
      "phoneBattery": obj.double("phoneBattery"),
      "boardName": (obj["boardName"] as? String).flatMap { $0.isEmpty ? nil : $0 },
      "target": (obj["target"] as? [String: Any]).map {
        ["lat": $0.double("lat") ?? 0, "lng": $0.double("lng") ?? 0]
      },
    ]
  }




  static func rosterRider(_ view: [String: Any?]) -> GroupRideRosterRider? {
    guard let id = view["id"] as? String else { return nil }
    let presence = view["presence"] as? [String: Any?]
    let lat = presence?["lat"] as? Double
    let lng = presence?["lng"] as? Double
    return GroupRideRosterRider(
      id: id,
      name: view["name"] as? String ?? "",
      position: lat.flatMap { lat in lng.map { WatchGeoPoint(latitude: lat, longitude: $0) } },
      stale: view["stale"] as? Bool ?? false,
      away: view["away"] as? Bool ?? false,
      lastSeenMs: view["lastSeen"] as? Int64 ?? 0,
      soc: presence?["soc"] as? Double,
      motorTempC: presence?["motorTemp"] as? Double,
      ctrlTempC: presence?["ctrlTemp"] as? Double
    )
  }







  // @parity /modules/vescape-core/src/index.ts `GroupRideConnectionState`
  private func emitConnection(_ state: String) {
    lastConnection = state
    emit("onGroupRideConnection", ["state": state])
  }

  private func onPublicPins(_ signals: [SignalRider], hazards: [String: RideHazard], relayNow: Int64?) {
    hazardCues.roster(hazards)
    let localNow = Int64(Date().timeIntervalSince1970 * 1000)
    let update = signalNotices.roster(signals, ownRiderId: nil, relayNow: relayNow, localNow: localNow)
    update.clears.forEach { RideNotices.shared.clear(key: $0) }
    update.posts.forEach { RideNotices.shared.post(key: $0.key, content: $0.content, revision: $0.revision) }
  }





  private func startHeartbeat() {
    stopHeartbeat()
    scheduleHeartbeat()
  }

  private func scheduleHeartbeat() {
    heartbeatWork = scheduler.postDelayed(Int64(Self.heartbeatIntervalSeconds * 1000)) { [weak self] in
      guard let self, !self.stopped, let ws = self.webSocket,
            self.publicRide.riding
      else { return }
      // The beat also ages the GPS fix a send needs.
      self.refreshSignalAvailability()
      self.send(ws, ["type": "heartbeat"])
      self.scheduleHeartbeat()
    }
  }

  private func stopHeartbeat() {
    heartbeatWork?.cancel()
    heartbeatWork = nil
  }

  private func schedulePing() {
    pingWork = scheduler.postDelayed(Int64(Self.pingIntervalSeconds * 1000)) { [weak self] in
      guard let self, !self.stopped, let ws = self.webSocket else { return }
      ws.ping()
      self.schedulePing()
    }
  }

  private func stopPing() {
    pingWork?.cancel()
    pingWork = nil
  }

  private func onMain(_ block: @escaping () -> Void) {
    if Thread.isMainThread { block() } else { DispatchQueue.main.async(execute: block) }
  }

  private static let pingIntervalSeconds: TimeInterval = 20
  // Must stay well under the server's 5s stale threshold: it's the sole keepalive when a Rider
  // isn't actively streaming presence (stationary, no GPS/board), so a slower beat would leave them
  // perpetually greyed as "Stale".
  private static let heartbeatIntervalSeconds: TimeInterval = 3
  private static let reconnectDelaysSeconds: [TimeInterval] = [1, 2, 5, 10, 30]
}

extension GroupRideObserver: URLSessionWebSocketDelegate {
  func urlSession(
    _ session: URLSession,
    webSocketTask: URLSessionWebSocketTask,
    didOpenWithProtocol protocol: String?
  ) {
    onOpen(webSocketTask)
  }

  func urlSession(
    _ session: URLSession,
    webSocketTask: URLSessionWebSocketTask,
    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
    reason: Data?
  ) {
    onClosed(webSocketTask, responseCode: nil)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let webSocketTask = task as? URLSessionWebSocketTask else { return }
    if let error { NSLog("[GroupRide] observe WS failure: \(error.localizedDescription)") }
    onClosed(webSocketTask, responseCode: (task.response as? HTTPURLResponse)?.statusCode)
  }
}

/// The relay socket as the observer drives it: a `URLSessionWebSocketTask` in production, a fake in
/// tests. Text frames only; the relay sends nothing else.
protocol GroupRideSocket: AnyObject {
  func open()
  func sendText(_ text: String, completion: @escaping (Error?) -> Void)
  func receiveText(_ completion: @escaping (Result<String?, Error>) -> Void)
  func ping()
  func close()
}

extension URLSessionWebSocketTask: GroupRideSocket {
  func open() { resume() }

  func sendText(_ text: String, completion: @escaping (Error?) -> Void) {
    send(.string(text), completionHandler: completion)
  }

  func receiveText(_ completion: @escaping (Result<String?, Error>) -> Void) {
    receive { result in
      completion(result.map { message in
        if case .string(let text) = message { return text }
        return nil
      })
    }
  }

  func ping() { sendPing { _ in } }

  func close() { cancel(with: .normalClosure, reason: nil) }
}

/// The Rider's shared map target (their direction Map Point).
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/GroupRideObserver.kt `TargetPoint`
internal struct TargetPoint {
  let lat: Double
  let lng: Double
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/GroupRideObserver.kt `RiderPresence`
internal struct RiderPresence {
  let lat: Double
  let lng: Double
  var heading: Double?
  var speed: Double?
  var soc: Double?
  var motorTemp: Double?
  var ctrlTemp: Double?
  var phoneBattery: Double?
  var boardName: String?
  var target: TargetPoint?
  var at: Int64?

  func toJson() -> [String: Any] {
    var json: [String: Any] = ["lat": lat, "lng": lng]
    if let heading { json["heading"] = heading }
    if let speed { json["speed"] = speed }
    if let soc { json["soc"] = soc }
    if let motorTemp { json["motorTemp"] = motorTemp }
    if let ctrlTemp { json["ctrlTemp"] = ctrlTemp }
    if let phoneBattery { json["phoneBattery"] = phoneBattery }
    if let boardName { json["boardName"] = boardName }
    if let target { json["target"] = ["lat": target.lat, "lng": target.lng] }
    return json
  }
}

private extension [String: Any] {
  func double(_ key: String) -> Double? { (self[key] as? NSNumber)?.doubleValue }
}
