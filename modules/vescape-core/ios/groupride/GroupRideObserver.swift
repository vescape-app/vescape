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

  private lazy var session = URLSession(
    configuration: .default,
    delegate: self,
    delegateQueue: nil
  )

  private var webSocket: URLSessionWebSocketTask?
  private var serverUrl: String?
  private var reconnectAttempt = 0
  private var stopped = true
  private var riderId: String?
  private var riderName: String?
  private var riderColor: String?
  private var joinedRideId: String?
  private var desiredRideId: String?
  private var lastPresence: RiderPresence?
  /// Remover for the App Status listener; non-nil only while observing.
  private var onlineUnsub: (() -> Void)?
  private var reconnectWork: DispatchWorkItem?
  private var heartbeatWork: DispatchWorkItem?
  private var pingWork: DispatchWorkItem?

  init(emit: @escaping (String, [String: Any?]) -> Void, online: OnlineCapability) {
    self.emit = emit
    self.online = online
  }

  /// True while the observe connection should be kept alive.
  var active: Bool { !stopped }

  /// True while the rider is in (or rejoining) a specific ride. Distinct from `active`: the app
  /// observes the lobby whenever it is open, but only real ride participation should block
  /// board-less shutdown paths.
  var participating: Bool { !stopped && (joinedRideId != nil || desiredRideId != nil) }

  func start(_ url: String) {
    if !stopped && url == serverUrl { return }
    stopped = false
    serverUrl = url
    reconnectAttempt = 0
    onlineUnsub?()
    // The gate can outlive the JS runtime, so the observe socket reacts to App Status changes
    // directly rather than through JS — tearing down on a block, resuming when it clears.
    onlineUnsub = online.addListener { [weak self] in self?.onOnlineChanged() }
    connect()
  }

  func stop() {
    stopped = true
    cancelReconnect()
    onlineUnsub?()
    onlineUnsub = nil
    webSocket?.cancel(with: .normalClosure, reason: nil)
    webSocket = nil
    joinedRideId = nil
    desiredRideId = nil
    lastPresence = nil
    stopHeartbeat()
    stopPing()
    emitConnection("idle")
  }

  /// React to an App Status change while observing: tear down the moment online work is blocked,
  /// or reconnect once a block clears. Runs on the main thread.
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

  /// Drop an active/reconnecting observe socket because online work is now blocked: cancel
  /// reconnect, close the socket, clear ride/roster state, and surface the distinct `blocked`
  /// connection state instead of a disconnect loop. Board Session, Recording, and History are
  /// untouched — this only gates Group Ride.
  private func tearDownForBlock() {
    cancelReconnect()
    webSocket?.cancel(with: .normalClosure, reason: nil)
    webSocket = nil
    reconnectAttempt = 0
    joinedRideId = nil
    desiredRideId = nil
    stopHeartbeat()
    stopPing()
    emit("onGroupRideJoined", ["rideId": nil])
    emit("onGroupRideRoster", ["rideId": nil, "riders": []])
    emitConnection("blocked")
  }

  /// Callback may arrive after its socket was closed or superseded.
  private func isCurrentSocket(_ task: URLSessionWebSocketTask) -> Bool {
    !stopped && !online.onlineBlocked && webSocket === task
  }

  /// Create a Group Ride over the live observe socket: bind this connection's Rider with `hello`,
  /// then send `create` carrying the creator's location and optional name. This is the only
  /// location egress while observing. The server fans the result back as `ride-created`, so there
  /// is no local optimistic insert here. No-op when not connected.
  func create(riderId: String, riderName: String, riderColor: String?, name: String?, lat: Double, lng: Double) {
    onMain { [self] in
      guard !stopped, let ws = webSocket else {
        NSLog("[GroupRide] create ignored: observe socket not connected")
        return
      }
      if joinedRideId != nil || desiredRideId != nil {
        send(ws, ["type": "leave"])
        joinedRideId = nil
        desiredRideId = nil
        stopHeartbeat()
      }
      sendHello(ws, riderId: riderId, riderName: riderName, riderColor: riderColor)
      lastPresence = RiderPresence(lat: lat, lng: lng)
      var create: [String: Any] = ["type": "create", "location": ["lat": lat, "lng": lng]]
      if let name, !name.trimmingCharacters(in: .whitespaces).isEmpty { create["name"] = name }
      send(ws, create)
    }
  }

  func join(riderId: String, riderName: String, riderColor: String?, rideId: String, presence: RiderPresence?) {
    onMain { [self] in
      guard !stopped, let ws = webSocket else {
        NSLog("[GroupRide] join ignored: observe socket not connected")
        return
      }
      let previousRideId = joinedRideId ?? desiredRideId
      if let previousRideId, previousRideId != rideId {
        send(ws, ["type": "leave"])
        joinedRideId = nil
        stopHeartbeat()
      }
      sendHello(ws, riderId: riderId, riderName: riderName, riderColor: riderColor)
      desiredRideId = rideId
      if let presence { lastPresence = presence }
      var join: [String: Any] = ["type": "join", "rideId": rideId]
      if let presence { join["presence"] = presence.toJson() }
      send(ws, join)
    }
  }

  func leave() {
    onMain { [self] in
      guard let ws = webSocket else { return }
      send(ws, ["type": "leave"])
      joinedRideId = nil
      desiredRideId = nil
      stopHeartbeat()
      emit("onGroupRideJoined", ["rideId": nil])
      emit("onGroupRideRoster", ["rideId": nil, "riders": []])
    }
  }

  /// Re-bind this connection's Rider identity after a name/color change. Updates the remembered
  /// identity (so a reconnect re-announces the fresh values) and, while the socket is live,
  /// re-sends `hello` — the server re-emits the roster so peers update without a rejoin. No-op when
  /// the observe socket is not connected.
  func updateIdentity(riderId: String, riderName: String, riderColor: String?) {
    onMain { [self] in
      self.riderId = riderId
      self.riderName = riderName
      self.riderColor = riderColor
      guard !stopped, let ws = webSocket else { return }
      sendHello(ws, riderId: riderId, riderName: riderName, riderColor: riderColor)
    }
  }

  func pushPresence(_ presence: RiderPresence) {
    onMain { [self] in
      guard !stopped, let ws = webSocket, joinedRideId != nil else { return }
      lastPresence = presence
      send(ws, ["type": "presence", "presence": presence.toJson()])
    }
  }

  private func connect() {
    guard let url = serverUrl, !stopped else { return }
    // Native owns the gate: refuse the upgrade (fresh start or scheduled reconnect) while online
    // work is blocked, surfacing `blocked` instead of hammering the relay.
    if online.onlineBlocked {
      emitConnection("blocked")
      return
    }
    guard let request = GroupRideOnlineGate.buildObserveRequest(url: url, appVersion: online.appVersion) else {
      NSLog("[GroupRide] observe URL is not usable: \(url)")
      return
    }
    emitConnection("connecting")
    let task = session.webSocketTask(with: request)
    webSocket = task
    task.resume()
    receive(on: task)
    schedulePing()
  }

  /// Re-arming receive loop. Failures are ignored here: the delegate's completion callback owns
  /// teardown and reconnect, so a socket error is handled once rather than twice.
  private func receive(on task: URLSessionWebSocketTask) {
    task.receive { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let message):
        self.onMain {
          guard self.isCurrentSocket(task) else { return }
          if case .string(let text) = message { self.handleMessage(text) }
        }
        self.receive(on: task)
      case .failure:
        break
      }
    }
  }

  private func onOpen(_ task: URLSessionWebSocketTask) {
    onMain { [self] in
      guard isCurrentSocket(task) else { return }
      reconnectAttempt = 0
      emitConnection("connected")
      guard let id = riderId, let name = riderName else { return }
      sendHello(task, riderId: id, riderName: name, riderColor: riderColor)
      if let rideId = desiredRideId { sendJoin(task, rideId: rideId, presence: lastPresence) }
    }
  }

  private func onClosed(_ task: URLSessionWebSocketTask, responseCode: Int?) {
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
    joinedRideId = nil
    stopHeartbeat()
    emitConnection("disconnected")
    let delay = Self.reconnectDelaysSeconds[min(reconnectAttempt, Self.reconnectDelaysSeconds.count - 1)]
    reconnectAttempt += 1
    let work = DispatchWorkItem { [weak self] in self?.connect() }
    reconnectWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
  }

  private func cancelReconnect() {
    reconnectWork?.cancel()
    reconnectWork = nil
  }

  private func handleMessage(_ text: String) {
    guard let data = text.data(using: .utf8),
          let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else {
      NSLog("[GroupRide] Discarding malformed Group Ride frame")
      return
    }
    switch json["type"] as? String {
    case "snapshot":
      let rides = (json["rides"] as? [Any] ?? []).compactMap { rideSummary($0 as? [String: Any]) }
      emit("onGroupRideSnapshot", ["rides": rides])
    case "ride-created":
      if let ride = rideSummary(json["ride"] as? [String: Any]) {
        emit("onGroupRideCreated", ["ride": ride])
      }
    case "ride-updated":
      if let ride = rideSummary(json["ride"] as? [String: Any]) {
        emit("onGroupRideUpdated", ["ride": ride])
      }
    case "ride-ended":
      guard let rideId = json["rideId"] as? String, !rideId.isEmpty else { return }
      emit("onGroupRideEnded", ["rideId": rideId])
      if rideId == joinedRideId {
        joinedRideId = nil
        desiredRideId = nil
        stopHeartbeat()
        emit("onGroupRideJoined", ["rideId": nil])
        emit("onGroupRideRoster", ["rideId": nil, "riders": []])
      }
    case "joined":
      guard let rideId = json["rideId"] as? String, !rideId.isEmpty else { return }
      joinedRideId = rideId
      desiredRideId = rideId
      startHeartbeat()
      emit("onGroupRideJoined", ["rideId": rideId])
    case "roster":
      let riders = (json["riders"] as? [Any] ?? []).compactMap { riderView($0 as? [String: Any]) }
      emit("onGroupRideRoster", [
        "rideId": (json["rideId"] as? String).flatMap { $0.isEmpty ? nil : $0 },
        "riders": riders,
      ])
    case "error":
      if let message = json["message"] as? String, !message.isEmpty { handleError(message) }
    default:
      break
    }
  }

  private func handleError(_ message: String) {
    if message.hasPrefix(Self.noSuchRidePrefix) {
      let missingRideId = String(message.dropFirst(Self.noSuchRidePrefix.count))
        .trimmingCharacters(in: .whitespaces)
      let isCurrentRide = missingRideId == desiredRideId || missingRideId == joinedRideId
      if !isCurrentRide { return }
      joinedRideId = nil
      desiredRideId = nil
      stopHeartbeat()
      emit("onGroupRideJoined", ["rideId": nil])
      emit("onGroupRideRoster", ["rideId": nil, "riders": []])
    }
    emit("onGroupRideError", ["message": message])
  }

  private func sendHello(_ task: URLSessionWebSocketTask, riderId: String, riderName: String, riderColor: String?) {
    self.riderId = riderId
    self.riderName = riderName
    self.riderColor = riderColor
    var hello: [String: Any] = ["type": "hello", "riderId": riderId, "name": riderName]
    if let riderColor, !riderColor.trimmingCharacters(in: .whitespaces).isEmpty {
      hello["color"] = riderColor
    }
    send(task, hello)
  }

  private func sendJoin(_ task: URLSessionWebSocketTask, rideId: String, presence: RiderPresence?) {
    var join: [String: Any] = ["type": "join", "rideId": rideId]
    if let presence { join["presence"] = presence.toJson() }
    send(task, join)
  }

  private func send(_ task: URLSessionWebSocketTask, _ frame: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: frame),
          let text = String(data: data, encoding: .utf8)
    else { return }
    task.send(.string(text)) { _ in }
  }

  /// Decode the `RideSummary` shape shared by `snapshot` and `ride-created`.
  private func rideSummary(_ obj: [String: Any]?) -> [String: Any?]? {
    guard let obj,
          let id = obj["id"] as? String, !id.isEmpty,
          let location = obj["location"] as? [String: Any],
          let creator = obj["creator"] as? [String: Any]
    else { return nil }
    return [
      "id": id,
      "name": obj["name"] as? String ?? "",
      "createdAt": (obj["createdAt"] as? NSNumber)?.int64Value ?? 0,
      "riderCount": (obj["riderCount"] as? NSNumber)?.intValue ?? 0,
      "location": [
        "lat": location.double("lat") ?? 0,
        "lng": location.double("lng") ?? 0,
      ],
      "creator": [
        "id": creator["id"] as? String ?? "",
        "name": creator["name"] as? String ?? "",
      ],
    ]
  }

  private func riderView(_ obj: [String: Any]?) -> [String: Any?]? {
    guard let obj, let id = obj["id"] as? String, !id.isEmpty else { return nil }
    return [
      "id": id,
      "name": obj["name"] as? String ?? "",
      "color": (obj["color"] as? String).flatMap { $0.isEmpty ? nil : $0 },
      "presence": presenceMap(obj["presence"] as? [String: Any]),
      "trail": trailList(obj["trail"] as? [Any]),
      "stale": obj["stale"] as? Bool ?? false,
      "lastSeen": (obj["lastSeen"] as? NSNumber)?.int64Value ?? 0,
    ]
  }

  private func trailList(_ arr: [Any]?) -> [[String: Any?]]? {
    guard let arr else { return nil }
    return arr.compactMap { entry in
      guard let point = entry as? [String: Any] else { return nil }
      return ["lat": point.double("lat") ?? 0, "lng": point.double("lng") ?? 0]
    }
  }

  private func presenceMap(_ obj: [String: Any]?) -> [String: Any?]? {
    guard let obj else { return nil }
    return [
      "lat": obj.double("lat") ?? 0,
      "lng": obj.double("lng") ?? 0,
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

  // @parity /modules/vescape-core/src/index.ts `GroupRideConnectionState`
  private func emitConnection(_ state: String) {
    emit("onGroupRideConnection", ["state": state])
  }

  private func startHeartbeat() {
    stopHeartbeat()
    scheduleHeartbeat()
  }

  private func scheduleHeartbeat() {
    let work = DispatchWorkItem { [weak self] in
      guard let self, !self.stopped, let ws = self.webSocket, self.joinedRideId != nil else { return }
      self.send(ws, ["type": "heartbeat"])
      self.scheduleHeartbeat()
    }
    heartbeatWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.heartbeatIntervalSeconds, execute: work)
  }

  private func stopHeartbeat() {
    heartbeatWork?.cancel()
    heartbeatWork = nil
  }

  /// Keepalive pings. OkHttp drives these from its client config; URLSession has no such knob, so
  /// the interval is scheduled by hand.
  /// @platform-diff Android configures `pingInterval` on the shared OkHttp client.
  private func schedulePing() {
    let work = DispatchWorkItem { [weak self] in
      guard let self, !self.stopped, let ws = self.webSocket else { return }
      ws.sendPing { _ in }
      self.schedulePing()
    }
    pingWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.pingIntervalSeconds, execute: work)
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
  private static let noSuchRidePrefix = "no such ride:"
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
  /// Numeric field, or nil when absent/null/non-numeric — the peer of Android's `optionalDouble`.
  func double(_ key: String) -> Double? { (self[key] as? NSNumber)?.doubleValue }
}
