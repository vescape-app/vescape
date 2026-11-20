import Foundation

/// Wall-clock tail after the last recorded event before a non-looping replay ends the session.
private let endTailMs: Int64 = 250

/// Where a `SimulatedBoard` is in its recording.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/replay/SimulatedBoard.kt `ReplayPlaybackState`
internal struct ReplayPlaybackState {
  let recording: String
  let positionMs: Int64
  let durationMs: Int64
  let paused: Bool
  let loop: Bool
  let linked: Bool
}

/// The board a replay session talks to in place of the GATT client (ADR 0048). It plays the
/// recording's timeline at its recorded offsets and answers the app's requests from the recording's
/// `ReplyBook` and its own state, so every session feature runs exactly as on a ride.
///
/// There is no radio to scan: a reconnect finds the board at once and the link resumes where
/// playback stopped.
///
/// Confined to the main queue, like the controller it serves. Listener callbacks are posted, never
/// called inline, so the controller never re-enters itself from a transport call.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/replay/SimulatedBoard.kt
internal final class SimulatedBoard: SessionTransport {
  private let recording: ReplayRecording
  private let timeline: [ReplayEvent]
  private let warmupEnd: Int
  private weak var listener: VescGattListener?
  private let scheduler: Scheduler
  private let onLocation: (ReplayLocation) -> Void
  /// The recording ran out without loop: the board powered off on purpose.
  private let onEnded: () -> Void

  private var cursor: Int
  private var positionMs: Int64
  /// Wall time of recorded offset 0 while the timeline runs.
  private var originMs: Int64 = 0
  private var pending: Cancellable?
  private var linked = false
  private var paused = false
  /// Read when the end comes, so it also decides an end already scheduled.
  private var looping: Bool

  /// Config the board holds beyond the recording: `[sig, bytes]` per `confInd`.
  private var heldConfig: [Int: [UInt8]] = [:]
  private var lightsBits = 0
  private var lastTelemetry: [UInt8]?
  private var lastBms: [UInt8]?

  init(
    recording: ReplayRecording,
    /// Recorded offset playback starts at; the controller prefills everything before it.
    warmupMs: Int64,
    loop: Bool,
    listener: VescGattListener,
    scheduler: Scheduler,
    onLocation: @escaping (ReplayLocation) -> Void,
    onEnded: @escaping () -> Void
  ) {
    self.recording = recording
    timeline = recording.timeline
    warmupEnd = timeline.firstIndex { $0.t >= warmupMs } ?? timeline.count
    cursor = warmupEnd
    positionMs = warmupMs
    looping = loop
    self.listener = listener
    self.scheduler = scheduler
    self.onLocation = onLocation
    self.onEnded = onEnded
    // The board was already holding whatever the warmup span wrote and last said.
    for event in warmup {
      switch event {
      case let .configWrite(_, payload): holdConfig(payload)
      case let .frame(_, payload): remember(payload)
      case .fix: break
      }
    }
  }

  /// The warmup span, for the controller to prefill display state from.
  var warmup: ArraySlice<ReplayEvent> { timeline[..<warmupEnd] }

  func state() -> ReplayPlaybackState {
    ReplayPlaybackState(
      recording: recording.name,
      positionMs: linked && !paused ? Self.wallMs() - originMs : positionMs,
      durationMs: recording.durationMs,
      paused: paused,
      loop: looping,
      linked: linked
    )
  }

  // MARK: - SessionTransport

  func connect(peripheralId: String) { relink() }

  func reconnect() { relink() }

  func disconnect() { unlink() }

  func startReconnectScan() {}

  func stopReconnectScan() {}

  @discardableResult
  func sendPayload(_ payload: [UInt8]) -> Bool {
    guard linked else { return false }
    guard let request = ReplayRecording.unwrapCan(payload) else { return true }
    scheduler.post { [weak self] in
      guard let self, self.linked, let reply = self.answer(request) else { return }
      self.reply(reply)
    }
    return true
  }

  /// Remote Tilt and Board Move: the board takes them and says nothing back.
  @discardableResult
  func sendRemoteInput(_ payload: [UInt8], urgent: Bool) -> Bool { linked }

  // MARK: - Controls

  func setPaused(_ value: Bool) {
    guard paused != value else { return }
    if value {
      freezeTimeline()
      paused = true
    } else {
      paused = false
      if linked { resumeTimeline() }
    }
  }

  func setLoop(_ value: Bool) { looping = value }

  /// Lose the link the way a board out of range does; the session's reconnect brings it back.
  func dropLink() {
    guard linked else { return }
    unlink()
    Self.log("replay link dropped recording=\(recording.name) positionMs=\(positionMs)")
    dispatch { $0.onGattDisconnected(intentional: false, message: "Replay link dropped") }
  }

  // MARK: - Timeline

  private func relink() {
    scheduler.post { [weak self] in
      guard let self, !self.linked else { return }
      self.linked = true
      Self.log("replay connect recording=\(self.recording.name) positionMs=\(self.positionMs)")
      self.dispatch { $0.onGattConnected() }
      self.dispatch { $0.onGattSubscribing() }
      self.dispatch { $0.onGattReady() }
      self.resumeTimeline()
      // Wall time of recorded t=0; `bun run preview` starts the wrist's replay from it.
      Self.log("replay playback started recording=\(self.recording.name) wallMs=\(self.originMs)")
    }
  }

  private func unlink() {
    guard linked else { return }
    if !paused { freezeTimeline() }
    linked = false
  }

  private func freezeTimeline() {
    if linked && !paused { positionMs = Self.wallMs() - originMs }
    pending?.cancel()
    pending = nil
  }

  private func resumeTimeline() {
    originMs = Self.wallMs() - positionMs
    if !paused { scheduleNext() }
  }

  /// Only the next event is ever queued, so an hour-long recording never floods the main queue.
  private func scheduleNext() {
    if cursor < timeline.count {
      let event = timeline[cursor]
      post(atRecorded: event.t) { [weak self] in
        guard let self else { return }
        self.cursor += 1
        self.play(event)
        self.scheduleNext()
      }
      return
    }
    post(atRecorded: recording.durationMs + endTailMs) { [weak self] in
      guard let self else { return }
      if self.looping {
        Self.log("replay looped recording=\(self.recording.name)")
        self.cursor = 0
        self.positionMs = 0
        self.resumeTimeline()
      } else {
        Self.log("replay finished recording=\(self.recording.name)")
        self.unlink()
        self.onEnded()
      }
    }
  }

  private func post(atRecorded recordedT: Int64, _ block: @escaping () -> Void) {
    pending = scheduler.postDelayed(max(0, originMs + recordedT - Self.wallMs())) { [weak self] in
      self?.pending = nil
      block()
    }
  }

  private func play(_ event: ReplayEvent) {
    switch event {
    case let .frame(_, payload):
      remember(payload)
      reply(payload)
    case let .fix(fix): onLocation(fix)
    case let .configWrite(_, payload): holdConfig(payload)
    }
  }

  private func remember(_ payload: [UInt8]) {
    if ReplayRecording.refloatCommand(payload) == REFLOAT_GET_ALLDATA {
      lastTelemetry = payload
    } else if Int(payload[0]) == COMM_BMS_GET_VALUES {
      lastBms = payload
    }
  }

  private func reply(_ payload: [UInt8]) {
    let frame = VescPacketCodec.encode(payload)
    dispatch { $0.onGattFrameChunk(frame) }
  }

  private func dispatch(_ call: @escaping (VescGattListener) -> Void) {
    scheduler.post { [weak self] in
      guard let listener = self?.listener else { return }
      call(listener)
    }
  }

  // MARK: - Answers

  /// The board's reply to `request`, or `nil` where a real board would say nothing it knows.
  private func answer(_ request: [UInt8]) -> [UInt8]? {
    let book = recording.replies
    switch Int(request[0]) {
    case COMM_FW_VERSION: return book.firmware
    case COMM_GET_MCCONF: return book.motorConfig
    // Polls are answered by the timeline; a paused board repeats what it last said.
    case COMM_BMS_GET_VALUES: return paused ? lastBms : nil
    case COMM_GET_CUSTOM_CONFIG_XML: return configXml(request)
    case COMM_GET_CUSTOM_CONFIG: return request.count > 1 ? config(Int(request[1])) : nil
    case COMM_SET_CUSTOM_CONFIG:
      return holdConfig(request).map { [UInt8(COMM_SET_CUSTOM_CONFIG), UInt8($0)] }
    case COMM_CUSTOM_APP_DATA:
      switch ReplayRecording.refloatCommand(request) {
      case REFLOAT_GET_INFO: return book.refloatInfo
      case REFLOAT_GET_ALLDATA: return paused ? lastTelemetry : nil
      case let command? where command == REFLOAT_LIGHTS_CONTROL || command == REFLOAT_LIGHTS_CONTROL_LEGACY:
        return lights(command, request)
      default: return nil
      }
    default: return nil
    }
  }

  /// `[92, confInd, len:i32, offset:i32]` → `[92, confInd, total:i32, offset:i32, bytes]`.
  private func configXml(_ request: [UInt8]) -> [UInt8]? {
    guard request.count >= 10 else { return nil }
    let confInd = Int(request[1])
    guard let xml = recording.replies.configXml[confInd] else { return nil }
    let length = Self.readInt32(request, 2)
    let offset = Self.readInt32(request, 6)
    guard offset >= 0, offset < xml.count, length > 0 else { return nil }
    let slice = xml[offset..<min(xml.count, offset + length)]
    return [UInt8(COMM_GET_CUSTOM_CONFIG_XML), UInt8(confInd)]
      + Self.int32Bytes(xml.count) + Self.int32Bytes(offset) + slice
  }

  /// What the board holds: its own last write, else the recording's snapshot as of now.
  private func config(_ confInd: Int) -> [UInt8]? {
    if let held = heldConfig[confInd] {
      return [UInt8(COMM_GET_CUSTOM_CONFIG), UInt8(confInd)] + held
    }
    guard let snapshots = recording.replies.configSnapshots[confInd] else { return nil }
    let now = state().positionMs
    return (snapshots.last { $0.t <= now } ?? snapshots.first)?.payload
  }

  /// Holds a `[95, confInd, sig, bytes]` write; returns its `confInd`.
  @discardableResult
  private func holdConfig(_ write: [UInt8]) -> Int? {
    guard write.count >= 6 else { return nil }
    let confInd = Int(write[1])
    heldConfig[confInd] = Array(write[2...])
    return confInd
  }

  /// Applies the masked value bits and echoes the switch state under the request's command id.
  private func lights(_ command: Int, _ request: [UInt8]) -> [UInt8]? {
    guard request.count >= 2 else { return nil }
    let mask = Int(request[request.count - 2])
    let value = Int(request[request.count - 1])
    lightsBits = (lightsBits & ~mask) | (value & mask)
    return [UInt8(COMM_CUSTOM_APP_DATA), request[1], UInt8(command), UInt8(lightsBits & 0xff)]
  }

  private static func log(_ message: String) { NSLog("[VescapeCore] %@", message) }

  private static func wallMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

  private static func readInt32(_ bytes: [UInt8], _ at: Int) -> Int {
    Int(Int32(bitPattern: UInt32(bytes[at]) << 24 | UInt32(bytes[at + 1]) << 16 | UInt32(bytes[at + 2]) << 8 | UInt32(bytes[at + 3])))
  }

  private static func int32Bytes(_ value: Int) -> [UInt8] {
    let bits = UInt32(bitPattern: Int32(truncatingIfNeeded: value))
    return [UInt8(bits >> 24), UInt8((bits >> 16) & 0xff), UInt8((bits >> 8) & 0xff), UInt8(bits & 0xff)]
  }
}
