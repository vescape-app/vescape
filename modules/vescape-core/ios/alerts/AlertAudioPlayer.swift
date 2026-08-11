import AVFoundation
import Foundation
#if canImport(UIKit)
import UIKit
#endif

private let ttsPrefix = "tts:"
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `ALERT_CATEGORY_SINGLE`
/// @parity /modules/vescape-core/src/index.ts `AlertSoundCategory`
internal let alertCategorySingle = "single"

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `ALERT_CATEGORY_GEIGER`
/// @parity /modules/vescape-core/src/index.ts `AlertSoundCategory`
internal let alertCategoryGeiger = "geiger"

/// Bundled alert sound preset. Mirrors Android `AlertSoundPreset`.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `AlertSoundPreset`
internal struct AlertSoundPreset {
  let name: String
  let uri: String
  let category: String
  let fileName: String

  func toMap() -> [String: Any] {
    ["name": name, "uri": uri, "category": category]
  }
}

internal let alertSoundPresets: [AlertSoundPreset] = [
  .init(name: "Beep", uri: "preset:beep", category: alertCategorySingle, fileName: "alert_beep"),
  .init(name: "Urgent", uri: "preset:urgent", category: alertCategorySingle, fileName: "alert_urgent"),
  .init(name: "Notify", uri: "preset:notify", category: alertCategorySingle, fileName: "alert_notify"),
  .init(name: "Tick", uri: "preset:tick", category: alertCategoryGeiger, fileName: "alert_tick"),
  .init(name: "Hard Tick", uri: "preset:tick_hard", category: alertCategoryGeiger, fileName: "alert_tick_hard"),
  .init(name: "Gamma", uri: "preset:gamma", category: alertCategoryGeiger, fileName: "alert_gamma"),
  .init(name: "Sustained", uri: "preset:sustained", category: alertCategoryGeiger, fileName: "alert_sustained"),
]

internal func alertSoundPresetMaps() -> [[String: Any]] {
  alertSoundPresets
    .filter { $0.uri != "preset:sustained" }
    .map { $0.toMap() }
}

/// Resolve a `soundType` URI to a preset, scoped by category when given. Falls back to
/// `preset:tick` for geiger and `preset:beep` otherwise. Mirrors Android `resolveAlertPreset`.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `resolveAlertPreset`
internal func resolveAlertPreset(soundType: String, category: String?) -> AlertSoundPreset {
  let key: String?
  if soundType.hasPrefix("preset:") {
    key = String(soundType.dropFirst("preset:".count))
  } else if soundType.contains(":") {
    key = nil
  } else if soundType == "default" {
    key = "beep"
  } else if soundType == "pulse" {
    key = "notify"
  } else {
    key = soundType
  }
  let uri = key.map { "preset:\($0)" }
  if let uri, let preset = alertSoundPresets.first(where: { $0.uri == uri }),
     category == nil || preset.category == category {
    return preset
  }
  if category == alertCategoryGeiger {
    return alertSoundPresets.first { $0.uri == "preset:tick" }!
  }
  return alertSoundPresets.first { $0.uri == "preset:beep" }!
}

/// A fired sample alert used for TTS preview rendering, mirroring Android `ttsSampleAlert`.
private func ttsSampleAlert(soundType: String) -> FiredAlert {
  FiredAlert(
    ruleId: "preview",
    controlId: "battery",
    value: 48.0,
    threshold: 50.0,
    thresholdMax: nil,
    soundType: soundType,
    rangeDepth: nil,
    beepCount: alertBeepCountDefault,
    firedAt: alertNowMs()
  )
}

private func alertNowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

/// One running geiger loop for a rule. Sustained loops a buffer continuously; ticking re-arms a
/// timer whose interval depends on the current `rangeDepth`.
private final class GeigerLoop {
  let soundType: String
  var rangeDepth: Double
  let sustained: Bool
  var workItem: DispatchWorkItem?
  /// Token used to cancel the sustained re-schedule cycle. A still-registered token with the same
  /// UUID means the completion-handler should keep looping; a changed/removed loop stops it.
  var sustainToken: UUID?
  var sustainedPlaying = false
  var sustainedNode: AVAudioPlayerNode?

  init(soundType: String, rangeDepth: Double, sustained: Bool) {
    self.soundType = soundType
    self.rangeDepth = rangeDepth
    self.sustained = sustained
  }
}

/// Alert audio feedback via `AVAudioEngine` with pre-loaded PCM buffers (low latency) plus
/// `AVSpeechSynthesizer` for Alert Message Templates. Mirrors Android `AlertFeedback`
/// (SoundPool + TextToSpeech). Must own the `AVAudioSession` while a board session is live so
/// alerts continue playing in the background (`audio` background mode) and mix with other audio
/// (music during a ride).
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `AlertFeedback`
/// @platform-diff iOS uses `AVAudioEngine` + `AVAudioPlayerNode` with pre-loaded `AVAudioPCMBuffer`s
/// instead of `SoundPool`; geiger tick scheduling uses `DispatchQueue.asyncAfter` instead of a
/// `Handler`; sustained loops schedule the buffer with a completion callback instead of SoundPool
/// loop index. TTS uses `AVSpeechSynthesizer` instead of Android `TextToSpeech`.
internal final class AlertAudioPlayer {
  private static let audioSessionLock = NSLock()
  private static var audioSessionOwnerCount = 0

  private let engine = AVAudioEngine()
  private let geigerQueue = DispatchQueue(label: "vescape.alerts.geiger", qos: .userInitiated)
  private let synthesizer = AVSpeechSynthesizer()
  private var buffersByFileName: [String: AVAudioPCMBuffer] = [:]
  private var geigerLoops: [String: GeigerLoop] = [:]
  private var activeOneShotNodes: [AVAudioPlayerNode] = []
  private var started = false
  private var ownsAudioSession = false
  private var released = false

  init() {
    acquireAudioSession()
    let standardFormat = makeStandardFormat()
    do {
      try engine.start()
      started = true
      Self.log("AlertAudioPlayer: engine started (format=\(standardFormat.sampleRate)Hz ch=\(standardFormat.channelCount) common=\(standardFormat.isStandard))")
    } catch {
      // Without the engine alerts stay silent, but the app keeps running. Sessions rarely fail
      // to start once the session is configured; a later play call will retry start (`startIfNeeded`).
      started = false
      Self.log("AlertAudioPlayer: engine.start FAILED: \(error)")
    }
    loadBuffers(using: standardFormat)
    Self.log("AlertAudioPlayer: buffers loaded=\(buffersByFileName.keys.sorted())")
  }

  deinit {
    release()
  }

  private static func log(_ message: String) {
    NSLog("[VescAlerts] %@", message)
  }

  // MARK: - Session

  /** AVAudioSession is process-global. Test and production players may overlap, so only the last
   * owner deactivates it; stopping a UI test must never silence the live Board alert player. */
  private func acquireAudioSession() {
    Self.audioSessionLock.lock()
    let shouldConfigure = Self.audioSessionOwnerCount == 0
    Self.audioSessionOwnerCount += 1
    ownsAudioSession = true
    Self.audioSessionLock.unlock()
    guard shouldConfigure else { return }

    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(
        .playback,
        mode: .default,
        options: [.mixWithOthers]
      )
      try session.setActive(true, options: [])
    } catch {
      // Soft-fail: playback category is the durable truth for background alerts; if the OS rejects
      // it (e.g. another app owns a non-mixable session), alerts degrade to silence rather than
      // crashing the bridge.
    }
  }

  private func releaseAudioSession() {
    guard ownsAudioSession else { return }
    ownsAudioSession = false
    Self.audioSessionLock.lock()
    Self.audioSessionOwnerCount = max(0, Self.audioSessionOwnerCount - 1)
    let shouldDeactivate = Self.audioSessionOwnerCount == 0
    Self.audioSessionLock.unlock()
    if shouldDeactivate {
      try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }
  }

  private func startIfNeeded() {
    guard !released, !started, engine.isRunning == false else { return }
    do {
      try AVAudioSession.sharedInstance().setActive(true, options: [])
      try engine.start()
      started = true
    } catch {
      started = false
    }
  }

  private func loadBuffers(using standardFormat: AVAudioFormat) {
    guard let bundleURL = bundledAssetsURL(), let bundle = Bundle(url: bundleURL) else {
      Self.log("AlertAudioPlayer: bundledAssetsURL missing — no presets will play")
      return
    }
    var buffers: [String: AVAudioPCMBuffer] = [:]
    for fileName in alertSoundPresets.map(\.fileName) + ["on", "off"] {
      guard let url = bundle.url(forResource: fileName, withExtension: "wav") else {
        Self.log("AlertAudioPlayer: missing \(fileName).wav in bundle")
        continue
      }
      guard let file = try? AVAudioFile(forReading: url) else {
        Self.log("AlertAudioPlayer: AVAudioFile read failed for \(fileName).wav")
        continue
      }
      guard let buffer = convertToStandard(file: file, standardFormat: standardFormat) else {
        Self.log("AlertAudioPlayer: convert failed for \(fileName).wav src=\(file.processingFormat)")
        continue
      }
      buffers[fileName] = buffer
    }
    buffersByFileName = buffers
  }

  private func makeStandardFormat() -> AVAudioFormat {
    if let format = AVAudioFormat(
      standardFormatWithSampleRate: engine.mainMixerNode.outputFormat(forBus: 0).sampleRate,
      channels: 1
    ) { return format }
    return AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1)!
  }

  /// Read `file` into a float32 buffer matching `standardFormat`. AVAudioFile reads in its native
  /// `processingFormat` (alert wavs are int16 PCM); when that differs from the engine's float32
  /// standard format, run an `AVAudioConverter` pass so `AVAudioPlayerNode` schedules one consistent
  /// format.
  private func convertToStandard(
    file: AVAudioFile,
    standardFormat: AVAudioFormat
  ) -> AVAudioPCMBuffer? {
    let srcFormat = file.processingFormat
    guard
      let srcBuffer = AVAudioPCMBuffer(pcmFormat: srcFormat, frameCapacity: AVAudioFrameCount(file.length))
    else { return nil }
    do {
      try file.read(into: srcBuffer)
    } catch {
      return nil
    }
    if srcFormat == standardFormat { return srcBuffer }
    guard let converter = AVAudioConverter(from: srcFormat, to: standardFormat) else { return nil }
    let ratio = standardFormat.sampleRate / srcFormat.sampleRate
    let outFrameCapacity = AVAudioFrameCount(ceil(Double(srcBuffer.frameLength) * ratio))
    guard let outBuffer = AVAudioPCMBuffer(pcmFormat: standardFormat, frameCapacity: outFrameCapacity) else {
      return nil
    }
    var consumed = false
    let inputBlock: AVAudioConverterInputBlock = { _, outStatus in
      if consumed {
        outStatus.pointee = .endOfStream
        return nil
      }
      consumed = true
      outStatus.pointee = .haveData
      return srcBuffer
    }
    var convertError: NSError?
    let status = converter.convert(to: outBuffer, error: &convertError, withInputFrom: inputBlock)
    guard status != .error, convertError == nil else { return nil }
    return outBuffer
  }

  private func bundledAssetsURL() -> URL? {
    let moduleBundle = Bundle(for: AlertAudioPlayer.self)
    if let url = moduleBundle.url(forResource: "VescapeCoreAssets", withExtension: "bundle") {
      return url
    }
    return nil
  }

  // MARK: - Connection sounds

  func playConnect() {
    play("on")
  }

  func playDisconnect() {
    play("off")
  }

  // MARK: - Single

  /// Play one announcement: `beepCount` plays of the rule's sound, `alertBeepSpacingMs` apart.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `playSingle`
  func playSingle(soundType: String, beepCount: Int = alertBeepCountDefault) {
    guard !released else { return }
    let preset = resolveAlertPreset(soundType: soundType, category: alertCategorySingle)
    let beeps = normalizedAlertBeepCount(beepCount)
    play(preset.fileName)
    guard beeps > 1 else { return }
    let spacing = alertBeepSpacingMs / 1000
    for index in 1..<beeps {
      geigerQueue.asyncAfter(deadline: .now() + spacing * Double(index)) { [weak self] in
        self?.play(preset.fileName)
      }
    }
  }

  // MARK: - Preview

  /// Play a preset once for UI preview, or speak a `tts:` template with a sample fired alert.
  func preview(soundType: String) {
    guard !released else { return }
    Self.log("AlertAudioPlayer.preview: \(soundType)")
    if soundType.hasPrefix(ttsPrefix) {
      let template = String(soundType.dropFirst(ttsPrefix.count))
      let text = renderAlertMessageTemplate(
        template,
        alert: ttsSampleAlert(soundType: soundType),
        batteryPercent: 42.0
      )
      Self.log("AlertAudioPlayer.preview TTS text='\(text)'")
      if !text.isEmpty { speakMessage(text) }
      return
    }
    let preset = resolveAlertPreset(soundType: soundType, category: nil)
    Self.log("AlertAudioPlayer.preview resolved=\(preset.uri) file=\(preset.fileName)")
    play(preset.fileName)
  }

  // MARK: - Geiger

  func updateGeiger(ruleId: String, soundType: String, rangeDepth: Double) {
    guard !released else { return }
    geigerQueue.async { [weak self] in
      self?.updateGeigerSync(ruleId: ruleId, soundType: soundType, rangeDepth: rangeDepth)
    }
  }

  private func updateGeigerSync(ruleId: String, soundType: String, rangeDepth: Double) {
    let depth = min(max(rangeDepth, 0.0), 1.0)
    let tickPreset = resolveAlertPreset(soundType: soundType, category: alertCategoryGeiger)
    let existing = geigerLoops[ruleId]

    if depth >= 1.0 {
      existing?.workItem?.cancel()
      if existing?.sustained == true && existing?.sustainedPlaying == true {
        return
      }
      stopSustained(ruleId: ruleId)
      let loop = GeigerLoop(soundType: soundType, rangeDepth: depth, sustained: true)
      geigerLoops[ruleId] = loop
      scheduleSustainedLoop(loop: loop, ruleId: ruleId, fileName: tickPreset.fileName)
      return
    }

    if existing?.sustained == true {
      stopSustained(ruleId: ruleId)
    }
    if let existing, !existing.sustained, existing.soundType == soundType {
      existing.rangeDepth = depth
      return
    }
    existing?.workItem?.cancel()
    let loop = GeigerLoop(soundType: soundType, rangeDepth: depth, sustained: false)
    geigerLoops[ruleId] = loop
    scheduleGeigerTick(loop: loop, ruleId: ruleId, fileName: tickPreset.fileName)
  }

  func stopGeiger(ruleId: String) {
    geigerQueue.async { [weak self] in
      guard let self else { return }
      if let loop = self.geigerLoops.removeValue(forKey: ruleId) {
        loop.workItem?.cancel()
        if loop.sustained { self.stopSustainedPlaybackForLoop(loop) }
      }
    }
  }

  func stopAllGeiger() {
    geigerQueue.async { [weak self] in
      guard let self else { return }
      for ruleId in Array(self.geigerLoops.keys) {
        if let loop = self.geigerLoops.removeValue(forKey: ruleId) {
          loop.workItem?.cancel()
          if loop.sustained { self.stopSustainedPlaybackForLoop(loop) }
        }
      }
    }
  }

  private func scheduleGeigerTick(loop: GeigerLoop, ruleId: String, fileName: String) {
    let startDepth = max(0, loop.rangeDepth)
    let startDelay = geigerIntervalMs(rangeDepth: startDepth)
    scheduleGeigerTick(loop: loop, ruleId: ruleId, fileName: fileName, delayMs: startDelay)
  }

  private func scheduleGeigerTick(loop: GeigerLoop, ruleId: String, fileName: String, delayMs: Int) {
    let workItem = DispatchWorkItem { [weak self] in
      guard let self else { return }
      guard let existing = self.geigerLoops[ruleId], existing === loop, !existing.sustained else { return }
      self.play(fileName)
      let interval = self.geigerIntervalMs(rangeDepth: loop.rangeDepth)
      self.scheduleGeigerTick(loop: loop, ruleId: ruleId, fileName: fileName, delayMs: interval)
    }
    loop.workItem = workItem
    geigerQueue.asyncAfter(deadline: .now() + Double(delayMs) / 1000.0, execute: workItem)
  }

  /// Loop the buffer continuously until the loop is cancelled by `stopGeiger`/`stopAllGeiger`.
  private func scheduleSustainedLoop(loop: GeigerLoop, ruleId: String, fileName: String) {
    let token = UUID()
    loop.sustainToken = token
    scheduleSustainedBuffer(loop: loop, ruleId: ruleId, fileName: fileName, token: token)
  }

  private func scheduleSustainedBuffer(loop: GeigerLoop, ruleId: String, fileName: String, token: UUID) {
    guard let buffer = buffersByFileName[fileName] else { return }
    startIfNeeded()
    let node = loop.sustainedNode ?? makePlayerNode(format: buffer.format)
    loop.sustainedNode = node
    loop.sustainedPlaying = true
    node.scheduleBuffer(buffer, at: nil, options: [], completionHandler: { [weak self, weak node] in
      // Re-arm only if the loop is still registered and its token hasn't changed (i.e. not
      // cancelled or replaced). Dispatch back to the geiger queue so loop state mutations stay
      // single-threaded.
      self?.geigerQueue.async {
        guard let self else { return }
        guard
          let current = self.geigerLoops[ruleId],
          current === loop, current.sustainToken == token
        else {
          if let node { self.detachPlayerNode(node) }
          return
        }
        self.scheduleSustainedBuffer(loop: loop, ruleId: ruleId, fileName: fileName, token: token)
      }
    })
    node.play()
  }

  private func stopSustained(ruleId: String) {
    if let loop = geigerLoops[ruleId] {
      stopSustainedPlaybackForLoop(loop)
    }
  }

  private func stopSustainedPlaybackForLoop(_ loop: GeigerLoop) {
    // Bump the token so any in-flight completion handler short-circuits instead of re-arming.
    loop.sustainToken = nil
    loop.sustainedPlaying = false
    if let node = loop.sustainedNode {
      node.stop()
      detachPlayerNode(node)
      loop.sustainedNode = nil
    }
  }

  private func geigerIntervalMs(rangeDepth: Double) -> Int {
    let clipped = min(max(rangeDepth, 0.0), 1.0)
    return Int(max(60, min(800, 800 - Int(740 * clipped))))
  }

  // MARK: - TTS

  func speakMessage(_ text: String) {
    guard !released else { return }
    let utterance = AVSpeechUtterance(string: text)
    utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
    utterance.preUtteranceDelay = 0
    synthesizer.stopSpeaking(at: .immediate)
    synthesizer.speak(utterance)
  }

  // MARK: - Vibration / haptics

  /// Haptic feedback mirroring Android `vibrate`. A range-less alert triggers a crisp waveform
  /// pattern; a geiger alert scales one-shot intensity with `rangeDepth`.
  func vibrate(rangeDepth: Double?) {
    guard !released else { return }
    #if canImport(UIKit)
    if let rangeDepth {
      let intensity = min(max(rangeDepth, 0.0), 1.0)
      let generator = UIImpactFeedbackGenerator(style: intensity > 0.7 ? .heavy : .medium)
      generator.impactOccurred(intensity: 0.5 + CGFloat(0.5 * intensity))
      return
    }
    let notification = UINotificationFeedbackGenerator()
    notification.notificationOccurred(.warning)
    #endif
  }

  // MARK: - Release

  func release() {
    guard !released else { return }
    released = true
    synthesizer.stopSpeaking(at: .immediate)
    geigerQueue.sync {
      for loop in geigerLoops.values {
        loop.workItem?.cancel()
        if let node = loop.sustainedNode {
          node.stop()
          detachPlayerNode(node)
        }
      }
      geigerLoops.removeAll(keepingCapacity: true)
      for node in activeOneShotNodes {
        node.stop()
        detachPlayerNode(node)
      }
      activeOneShotNodes.removeAll(keepingCapacity: true)
    }
    if engine.isRunning { engine.stop() }
    started = false
    releaseAudioSession()
    buffersByFileName.removeAll(keepingCapacity: true)
  }

  // MARK: - Low-level

  private func play(_ fileName: String) {
    guard !released else { return }
    guard let buffer = buffersByFileName[fileName] else {
      Self.log("AlertAudioPlayer.play: NO BUFFER for \(fileName)")
      return
    }
    startIfNeeded()
    Self.log("AlertAudioPlayer.play: schedule \(fileName) engine.running=\(engine.isRunning) frames=\(buffer.frameLength)")
    let node = makePlayerNode(format: buffer.format)
    activeOneShotNodes.append(node)
    node.scheduleBuffer(buffer, at: nil, options: [], completionHandler: { [weak self, weak node] in
      guard let self, let node else { return }
      self.geigerQueue.async {
        self.activeOneShotNodes.removeAll { $0 === node }
        self.detachPlayerNode(node)
      }
    })
    node.play()
  }

  private func makePlayerNode(format: AVAudioFormat) -> AVAudioPlayerNode {
    let node = AVAudioPlayerNode()
    engine.attach(node)
    engine.connect(node, to: engine.mainMixerNode, format: format)
    return node
  }

  private func detachPlayerNode(_ node: AVAudioPlayerNode) {
    engine.disconnectNodeOutput(node)
    engine.detach(node)
  }
}
