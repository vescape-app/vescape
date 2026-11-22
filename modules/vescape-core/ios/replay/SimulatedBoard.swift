import Foundation

private let endTailMs: Int64 = 250

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/replay/SimulatedBoard.kt `ReplayPlaybackState`
/// @parity /modules/vescape-core/src/index.ts `DebugReplayState`
internal struct ReplayPlaybackState {
  let recording: String
  let positionMs: Int64
  let durationMs: Int64
  let paused: Bool
  let loop: Bool
  let linked: Bool
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/replay/SimulatedBoard.kt
internal final class SimulatedBoard: SessionTransport {
  private let recording: ReplayRecording
  private let timeline: [ReplayEvent]
  private let warmupEnd: Int
  private weak var listener: VescGattListener?
  private let scheduler: Scheduler
  private let onLocation: (ReplayLocation) -> Void
  private let onEnded: () -> Void

  private var cursor: Int
  private var positionMs: Int64
  private var originMs: Int64 = 0
  private var pending: Cancellable?
  private var linked = false
  private var link = 0
  private var paused = false
  private var looping: Bool

  private var heldConfig: [Int: [UInt8]] = [:]
  private var lightsBits = 0
  private var lastTelemetry: [UInt8]?
  private var lastBms: [UInt8]?

  init(
    recording: ReplayRecording,
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
    for event in warmup {
      switch event {
      case let .configWrite(_, payload): holdConfig(payload)
      case let .frame(_, payload): remember(payload)
      case .fix: break
      }
    }
  }

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

  func connect(peripheralId: String) {
    unlink()
    relink()
  }

  func reconnect() {
    unlink()
    relink()
  }

  func disconnect() { unlink() }

  func startReconnectScan() {}

  func stopReconnectScan() {}

  @discardableResult
  func sendPayload(_ payload: [UInt8]) -> Bool {
    guard linked else { return false }
    guard let request = ReplayRecording.unwrapCan(payload) else { return true }
    onLink { $0.answer(request).map($0.reply) }
    return true
  }

  @discardableResult
  func sendRemoteInput(_ payload: [UInt8], urgent: Bool) -> Bool { linked }

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

  func dropLink() {
    guard linked else { return }
    unlink()
    Self.log("replay link dropped recording=\(recording.name) positionMs=\(positionMs)")
    dispatch { $0.onGattDisconnected(intentional: false, message: "Replay link dropped") }
  }

  private func relink() {
    onLink { $0.establish() }
  }

  private func establish() {
    linked = true
    Self.log("replay connect recording=\(recording.name) positionMs=\(positionMs)")
    dispatch { $0.onGattConnected() }
    dispatch { $0.onGattSubscribing() }
    dispatch { $0.onGattReady() }
    resumeTimeline()
    Self.log("replay playback started recording=\(recording.name) wallMs=\(originMs)")
  }

  private func unlink() {
    link += 1
    guard linked else { return }
    if !paused { freezeTimeline() }
    linked = false
  }

  private func onLink(_ block: @escaping (SimulatedBoard) -> Void) {
    let queuedOn = link
    scheduler.post { [weak self] in
      guard let self, self.link == queuedOn else { return }
      block(self)
    }
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
    onLink { board in board.listener.map(call) }
  }

  private func answer(_ request: [UInt8]) -> [UInt8]? {
    let book = recording.replies
    switch Int(request[0]) {
    case COMM_FW_VERSION: return book.firmware
    case COMM_GET_MCCONF: return book.motorConfig
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

  private func config(_ confInd: Int) -> [UInt8]? {
    if let held = heldConfig[confInd] {
      return [UInt8(COMM_GET_CUSTOM_CONFIG), UInt8(confInd)] + held
    }
    guard let snapshots = recording.replies.configSnapshots[confInd] else { return nil }
    let now = state().positionMs
    return (snapshots.last { $0.t <= now } ?? snapshots.first)?.payload
  }

  @discardableResult
  private func holdConfig(_ write: [UInt8]) -> Int? {
    guard write.count >= 6 else { return nil }
    let confInd = Int(write[1])
    heldConfig[confInd] = Array(write[2...])
    return confInd
  }

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
