import AVFoundation
import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `ALERT_CATEGORY_SINGLE`
/// @parity /modules/vescape-core/src/index.ts `AlertSoundCategory`
internal let alertCategorySingle = "single"

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `ALERT_CATEGORY_GEIGER`
/// @parity /modules/vescape-core/src/index.ts `AlertSoundCategory`
internal let alertCategoryGeiger = "geiger"

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `alertSoundMaps`
/// @parity /modules/vescape-core/src/index.ts `FALLBACK_SOUNDS`
internal func alertSoundChoices() -> [[String: Any]] {
  [
    ("Info", "alert:info", alertCategorySingle),
    ("Warning", "alert:warning", alertCategorySingle),
    ("Critical", "alert:critical", alertCategorySingle),
    ("Soft", "geiger:soft", alertCategoryGeiger),
    ("Mid", "geiger:mid", alertCategoryGeiger),
    ("Hard", "geiger:hard", alertCategoryGeiger),
  ].map { ["name": $0.0, "uri": $0.1, "category": $0.2] }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/EffectsPacks.kt `previewSlot`
internal func previewSlot(_ spec: String) -> String {
  isGeigerSpec(spec) ? geigerSlot(spec) : parseSlotAlertSound(spec).severity.slot
}

private func ttsSampleAlert(spec: String) -> FiredAlert {
  FiredAlert(
    ruleId: "preview",
    controlId: "battery",
    value: 48.0,
    threshold: 50.0,
    thresholdMax: nil,
    spec: spec,
    rangeDepth: nil,
    firedAt: alertNowMs()
  )
}

private func alertNowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

private final class GeigerLoop {
  let spec: String
  var rangeDepth: Double
  let sustained: Bool
  var workItem: Cancellable?
  var sustainToken: UUID?
  var sustainedPlaying = false
  var sustainedNode: LeasedNode?
  var sustainedKey: String?

  init(spec: String, rangeDepth: Double, sustained: Bool) {
    self.spec = spec
    self.rangeDepth = rangeDepth
    self.sustained = sustained
  }
}

private struct LeasedNode {
  let node: AVAudioPlayerNode
  let lease: UUID
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `ALERT_AUDIO_LATENCY_REPORT_MS`
internal let alertAudioLatencyReportMs: Int64 = 150

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `AlertFeedback`
/// @platform-diff iOS uses `AVAudioEngine` + `AVAudioPlayerNode` with pre-loaded `AVAudioPCMBuffer`s
internal final class AlertAudioPlayer {
  private static let audioSessionLock = NSLock()
  private static var audioSessionOwnerCount = 0

  private let engine = AVAudioEngine()
  private static let geigerQueueMarker = DispatchSpecificKey<ObjectIdentifier>()
  private let geigerQueue: DispatchQueue
  private let scheduler: Scheduler
  private let synthesizer = AVSpeechSynthesizer()
  private let speechCompletions = SpeechCompletions()
  private let playback: PlaybackTracker
  private let assetsDirectory: URL?
  private var buffersBySlot: [String: AVAudioPCMBuffer] = [:]
  private var clipDurationsMs: [String: Int64] = [:]
  private var myBuffers: [String: AVAudioPCMBuffer?] = [:]
  private let myBuffersLock = NSLock()
  var soundPack = effectsPackFallback
  private var voice = voiceMatching
  private var voiceLevel = voiceLevelDefault
  private var packsRoot: URL?
  private var effectsVoices: [String: String] = [:]
  private var voiceManifests: [String: VoicePackManifest] = [:]
  private var voiceClips: [String: AVAudioPCMBuffer] = [:]
  private let voiceLock = NSLock()
  private let voicePicker = VoiceVariantPicker()
  private var preparedVoice: [String: (files: [String], buffer: AVAudioPCMBuffer)] = [:]
  private var voiceNode: LeasedNode?
  private var geigerLoops: [String: GeigerLoop] = [:]
  private var activeOneShotNodes: [AVAudioPlayerNode] = []
  private var attachedNodes: [ObjectIdentifier: (node: AVAudioPlayerNode, format: AVAudioFormat)] = [:]
  private var idleNodes: [AVAudioPlayerNode] = []
  private var nodeLeases: [ObjectIdentifier: UUID] = [:]
  private static let idleNodeLimit = 8
  private var lateReported: Set<String> = []
  var onDiagnostic: (String, [String: Any?]) -> Void = { _, _ in }
  private var started = false
  private var idleRequested = false
  private var ownsAudioSession = false
  private let releasedLock = NSLock()
  private var released = false

  init(
    assetsDirectory: URL? = nil,
    outputVolume: Float = 1,
    geigerQueue: DispatchQueue = DispatchQueue(label: "vescape.alerts.geiger", qos: .userInitiated),
    scheduler: Scheduler? = nil
  ) {
    self.assetsDirectory = assetsDirectory
    self.geigerQueue = geigerQueue
    self.scheduler = scheduler ?? DispatchQueueScheduler(queue: geigerQueue)
    playback = PlaybackTracker(deliver: { geigerQueue.async(execute: $0) })
    synthesizer.delegate = speechCompletions
    geigerQueue.setSpecific(key: Self.geigerQueueMarker, value: ObjectIdentifier(self))
    acquireAudioSession()
    let standardFormat = makeStandardFormat()
    engine.mainMixerNode.outputVolume = outputVolume
    do {
      try engine.start()
      started = true
      Self.log("AlertAudioPlayer: engine started (format=\(standardFormat.sampleRate)Hz ch=\(standardFormat.channelCount) common=\(standardFormat.isStandard))")
    } catch {
      started = false
      Self.log("AlertAudioPlayer: engine.start FAILED: \(error)")
      UnexpectedNativeError.report(operation: "alert_audio_engine_start", category: "audio_start_failed", error: error)
    }
    loadBuffers(using: standardFormat)
    Self.log("AlertAudioPlayer: buffers loaded=\(buffersBySlot.keys.sorted())")
  }

  deinit {
    release()
  }

  private var isReleased: Bool {
    releasedLock.lock()
    defer { releasedLock.unlock() }
    return released
  }

  private func onGeigerQueue(_ block: @escaping (AlertAudioPlayer) -> Void) {
    geigerQueue.async { [weak self] in
      guard let self, !self.isReleased else { return }
      block(self)
    }
  }

  private func markReleased() -> Bool {
    releasedLock.lock()
    defer { releasedLock.unlock() }
    if released { return false }
    released = true
    return true
  }

  private static func log(_ message: String) {
    NSLog("[VescAlerts] %@", message)
  }

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
      UnexpectedNativeError.report(operation: "alert_audio_session_configure", category: "audio_session_failed", error: error)
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
      // intentional-suppression: audio teardown is best effort and asset-open failure is reported
      try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }
  }

  private func startIfNeeded() {
    idleRequested = false
    guard !isReleased, !started, engine.isRunning == false else { return }
    do {
      try activateSession()
      try engine.start()
      started = true
    } catch {
      started = false
      UnexpectedNativeError.report(operation: "alert_audio_engine_restart", category: "audio_start_failed", error: error)
    }
  }

  private func activateSession() throws {
    try AVAudioSession.sharedInstance().setActive(true, options: [])
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `goIdle`
  func goIdle() {
    geigerQueue.async { [weak self] in
      guard let self, !self.isReleased else { return }
      self.idleRequested = true
      self.idleIfQuietOnQueue()
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `wake`
  func wake() {
    onGeigerQueue { owner in
      owner.lateReported.removeAll()
      owner.startIfNeeded()
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `prepare`
  func prepare(Specs: [String]) {
    onGeigerQueue { owner in
      let slots = Set(owner.buffersBySlot.keys.compactMap { $0.split(separator: "/").last.map(String.init) })
        .union(optionalSlotFallback.keys)
      let voice = owner.voicePack()
      DispatchQueue.global(qos: .utility).async { [weak owner] in
        guard let owner else { return }
        for slot in slots { _ = owner.clipKey(slot) }
        for spec in Specs { if let url = mySoundId(spec).flatMap(MySounds.file) { _ = owner.myBufferKey(url) } }
        owner.prewarmVoice(voice)
      }
    }
  }

  private func idleIfQuietOnQueue() {
    guard idleRequested, !isReleased else { return }
    guard geigerLoops.isEmpty, activeOneShotNodes.isEmpty else { return }
    idleRequested = false
    synthesizer.stopSpeaking(at: .immediate)
    if engine.isRunning { engine.stop() }
    started = false
    // intentional-suppression: audio deactivation is best effort; a refusal just leaves it active
    try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
  }

  private func loadBuffers(using standardFormat: AVAudioFormat) {
    let root: URL
    if let assetsDirectory {
      root = assetsDirectory
    } else {
      guard let bundleURL = bundledAssetsURL() else {
        Self.log("AlertAudioPlayer: bundledAssetsURL missing — no sounds will play")
        UnexpectedNativeError.report(operation: "alert_audio_bundle_missing", category: "required_asset_missing", error: CocoaError(.fileNoSuchFile))
        return
      }
      root = bundleURL.appendingPathComponent("alert-packs")
    }
    packsRoot = root
    effectsVoices = effectsPackVoices(root: root)
    let files = effectsPackSlotFiles(root: root)
    if files.isEmpty {
      UnexpectedNativeError.report(operation: "alert_audio_asset_missing", category: "required_asset_missing", error: CocoaError(.fileNoSuchFile))
    }
    var buffers: [String: AVAudioPCMBuffer] = [:]
    for (key, url) in files {
      // intentional-suppression: audio teardown is best effort and asset-open failure is reported
      guard let file = try? AVAudioFile(forReading: url) else {
        Self.log("AlertAudioPlayer: AVAudioFile read failed for \(key)")
        UnexpectedNativeError.report(operation: "alert_audio_asset_open", category: "audio_decode_failed", error: CocoaError(.fileReadCorruptFile))
        continue
      }
      guard let buffer = convertToStandard(file: file, standardFormat: standardFormat) else {
        Self.log("AlertAudioPlayer: convert failed for \(key) src=\(file.processingFormat)")
        continue
      }
      buffers[key] = buffer
    }
    buffersBySlot = buffers
    clipDurationsMs = buffers.mapValues { Int64(Double($0.frameLength) / $0.format.sampleRate * 1000) }
  }

  private func slotKey(_ slot: String, pack: String? = nil) -> String {
    "\(effectsPackId(pack ?? soundPack))/\(slot)"
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/EffectsPacks.kt `slotClip`
  private func clipKey(_ slot: String, my: String? = nil, pack: String? = nil) -> String {
    if let key = my.flatMap(MySounds.file).flatMap(myBufferKey) { return key }
    let packHas = { self.buffersBySlot[self.slotKey($0, pack: pack)] != nil }
    let target = lookupSlot(slot, hasOverride: { MySounds.overrideFile($0) != nil }, packHas: packHas)
    if let key = MySounds.overrideFile(target).flatMap(myBufferKey) { return key }
    return slotKey(lookupSlot(slot, hasOverride: { _ in false }, packHas: packHas), pack: pack)
  }

  private func myBufferKey(_ url: URL) -> String? {
    let key = "my/\(url.lastPathComponent)"
    myBuffersLock.lock()
    defer { myBuffersLock.unlock() }
    if let cachedBuffer = myBuffers[key] { return cachedBuffer == nil ? nil : key }
    // intentional-suppression: an undecodable My sound plays the pack slot instead
    let buffer = (try? AVAudioFile(forReading: url)).flatMap {
      convertToStandard(file: $0, standardFormat: makeStandardFormat())
    }
    myBuffers[key] = .some(buffer)
    return buffer == nil ? nil : key
  }

  private func buffer(_ key: String) -> AVAudioPCMBuffer? {
    guard key.hasPrefix("my/") else { return buffersBySlot[key] }
    myBuffersLock.lock()
    defer { myBuffersLock.unlock() }
    return myBuffers[key] ?? nil
  }

  private func clipDurationMs(_ key: String) -> Int64 {
    guard key.hasPrefix("my/") else { return clipDurationsMs[key] ?? 0 }
    return buffer(key).map { Int64(Double($0.frameLength) / $0.format.sampleRate * 1000) } ?? 0
  }

  private func makeStandardFormat() -> AVAudioFormat {
    if let format = AVAudioFormat(
      standardFormatWithSampleRate: engine.mainMixerNode.outputFormat(forBus: 0).sampleRate,
      channels: 1
    ) { return format }
    return AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1)!
  }

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
      UnexpectedNativeError.report(operation: "alert_audio_asset_decode", category: "audio_decode_failed", error: error)
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
    guard status != .error, convertError == nil else {
      UnexpectedNativeError.report(operation: "alert_audio_asset_convert", category: "audio_decode_failed", error: convertError ?? CocoaError(.fileReadCorruptFile))
      return nil
    }
    return outBuffer
  }

  private func bundledAssetsURL() -> URL? {
    let moduleBundle = Bundle(for: AlertAudioPlayer.self)
    if let url = moduleBundle.url(forResource: "VescapeCoreAssets", withExtension: "bundle") {
      return url
    }
    return nil
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `setSoundSettings`
  func applySoundSettings(_ settings: [String: Any?]) {
    soundPack = settings["soundPack"] as? String ?? soundPack
    voice = settings["voice"] as? String ?? voice
    voiceLevel = settings["voiceLevel"] as? String ?? voiceLevel
    let pack = voicePack()
    DispatchQueue.global(qos: .utility).async { [weak self] in self?.prewarmVoice(pack) }
  }

  private func voicePack() -> String {
    voicePackId(voice, effectsVoice: effectsVoices[effectsPackId(soundPack)])
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `boardConnected`
  func boardConnected(playCue: Bool) {
    onGeigerQueue { player in
      player.announcements.connected(now: Self.uptimeMs())
      if playCue { player.enqueueAppCue("on", onDone: { _ in }) }
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `boardDisconnected`
  func boardDisconnected(playCue: Bool) {
    onGeigerQueue { player in
      player.clearAnnouncementsOnQueue()
      if playCue { player.enqueueAppCue("off", onDone: { _ in }) }
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `playAppCue`
  func playAppCue(_ cue: String, onDone: @escaping PlaybackDone = { _ in }) {
    guard appCuePriority(cue) != nil else {
      onDone(.failed)
      return
    }
    onGeigerQueue { $0.enqueueAppCue(cue, onDone: onDone) }
  }

  private func enqueueAppCue(_ cue: String, onDone: @escaping PlaybackDone) {
    guard let priority = appCuePriority(cue) else {
      onDone(.failed)
      return
    }
    announce(priority: priority, onDone: onDone) { [weak self] done in self?.playAppCueNow(cue, done: done) }
  }

  private func playAppCueNow(_ cue: String, done: PlaybackCompletion) {
    guard let slot = appCueSlot(cue) else {
      done.finish(.failed)
      return
    }
    if appCueSpeaks(cue, voiceLevel: voiceLevel), let key = appCueVoiceKey(cue) {
      speakVoiceTracked(VoiceAnnouncement(severity: .info, key: key), slot: slot, done: done)
    } else {
      play(clipKey(slot)) { done.finish($0) }
    }
  }

  private final class QueuedAnnouncement {
    let play: (PlaybackCompletion) -> Void
    let onDone: PlaybackDone
    var attempt: PlaybackCompletion?

    init(play: @escaping (PlaybackCompletion) -> Void, onDone: @escaping PlaybackDone) {
      self.play = play
      self.onDone = onDone
    }
  }

  private let announcements = AnnouncementQueue<QueuedAnnouncement>()
  private var pendingPump: Cancellable?

  private static func uptimeMs() -> Int64 { Int64(DispatchTime.now().uptimeNanoseconds / 1_000_000) }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `announce`
  private func announce(
    priority: AnnouncementPriority,
    ttlMs: Int64? = nil,
    onDone: @escaping PlaybackDone,
    play: @escaping (PlaybackCompletion) -> Void
  ) {
    guard !isReleased else {
      onDone(.cancelled)
      return
    }
    announcements.enqueue(QueuedAnnouncement(play: play, onDone: onDone), priority: priority, now: Self.uptimeMs(), ttlMs: ttlMs)
    pumpAnnouncements()
  }

  private func pumpAnnouncements() {
    pendingPump?.cancel()
    pendingPump = nil
    guard !isReleased else { return }
    let now = Self.uptimeMs()
    switch announcements.next(now: now, onDrop: { $0.onDone(.cancelled) }) {
    case .play(let item):
      let attempt = track { [weak self] outcome in
        guard let self, self.announcements.playing === item else { return }
        self.announcements.finished(outcome, now: Self.uptimeMs())?.onDone(outcome)
        self.pumpAnnouncements()
      }
      item.attempt = attempt
      item.play(attempt)
    case .waitUntil(let at):
      pendingPump = scheduler.postDelayed(max(0, at - now)) { [weak self] in
        self?.onGeigerQueue { $0.pumpAnnouncements() }
      }
    case .idle:
      break
    }
  }

  private func stopAnnouncement(_ item: QueuedAnnouncement) {
    guard let attempt = item.attempt else { return }
    guard playback.isSpeech(attempt) else {
      attempt.finish(.completed)
      return
    }
    _ = nextSpeechGeneration()
    synthesizer.stopSpeaking(at: .immediate)
    stopVoiceOnQueue()
    attempt.finish(.cancelled)
  }

  private func clearAnnouncementsOnQueue() {
    pendingPump?.cancel()
    pendingPump = nil
    for item in announcements.clear() {
      stopAnnouncement(item)
      item.onDone(.cancelled)
    }
  }

  private func startCritical(
    _ onDone: @escaping PlaybackDone,
    _ start: @escaping (AlertAudioPlayer, PlaybackCompletion) -> Void
  ) {
    geigerQueue.async { [weak self] in
      guard let self else { return onDone(.cancelled) }
      let done = self.track(self.critical(onDone))
      guard !self.isReleased else {
        done.finish(.cancelled)
        return
      }
      start(self, done)
    }
  }

  private func critical(_ onDone: @escaping PlaybackDone) -> PlaybackDone {
    if let item = announcements.criticalStarted() { stopAnnouncement(item) }
    return { [weak self] outcome in
      if let self {
        self.announcements.criticalEnded(now: Self.uptimeMs())
        self.pumpAnnouncements()
      }
      onDone(outcome)
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `track`
  private func track(_ onDone: @escaping PlaybackDone) -> PlaybackCompletion {
    let done = playback.start(onDone)
    scheduler.postDelayed(playbackDoneTimeoutMs) { done.finish(.failed) }
    return done
  }

  func playPackSound(pack: String, slot: String) {
    play(clipKey(slot, pack: pack))
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `playSingle`
  func playSingle(spec: String, onDone: @escaping PlaybackDone = { _ in }) {
    startCritical(onDone) { player, done in
      player.playSeverity(parseSlotAlertSound(spec), my: mySoundId(spec)) { done.finish($0) }
    }
  }

  private func playSeverity(_ sound: SlotAlertSound, my: String? = nil, onDone: PlaybackDone? = nil) {
    guard !isReleased else {
      onDone?(.cancelled)
      return
    }
    let key = clipKey(sound.severity.slot, my: my)
    play(key, onDone: sound.count > 1 ? nil : onDone)
    guard sound.count > 1 else { return }
    let duration = Double(clipDurationMs(key))
    let interval = duration > alertBeepSpacingMs ? duration + alertBeepSpacingMs : alertBeepSpacingMs
    for index in 1..<sound.count {
      let last = index == sound.count - 1
      scheduler.postDelayed(Int64(interval * Double(index))) { [weak self] in
        self?.onGeigerQueue { $0.playOnQueue(key, onDone: last ? onDone : nil) }
      }
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `speakAfterSeverity`
  func speakAfterSeverity(_ severity: AlertSeverity, text: String, onDone: @escaping PlaybackDone = { _ in }) {
    startCritical(onDone) { player, done in player.speakAfterSeverityOnQueue(severity, text: text, done: done) }
  }

  private func speakAfterSeverityOnQueue(_ severity: AlertSeverity, text: String, done: PlaybackCompletion) {
    pendingSpeech?.cancel()
    playback.claimSpeech(done)
    let generation = nextSpeechGeneration()
    playSeverity(SlotAlertSound(count: 1, severity: severity))
    let delay = speechDelayMs(clipDurationMs(clipKey(severity.slot)))
    pendingSpeech = scheduler.postDelayed(delay) { [weak self] in
      guard let self, self.isCurrentSpeech(generation) else { return }
      self.speakTracked(text, done: done)
    }
  }

  private var pendingSpeech: Cancellable?
  private var speechGeneration = 0
  private let speechGenerationLock = NSLock()

  private func nextSpeechGeneration() -> Int {
    speechGenerationLock.lock()
    defer { speechGenerationLock.unlock() }
    speechGeneration += 1
    return speechGeneration
  }

  private func isCurrentSpeech(_ generation: Int) -> Bool {
    speechGenerationLock.lock()
    defer { speechGenerationLock.unlock() }
    return speechGeneration == generation
  }

  var presetVoiceEnabled: Bool { voiceLevel != "off" }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `speakVoice`
  func speakVoice(_ announcement: VoiceAnnouncement, slot: String? = nil, onDone: @escaping PlaybackDone = { _ in }) {
    startCritical(onDone) { player, done in player.speakVoiceTracked(announcement, slot: slot, done: done) }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `speakAdvisory`
  func speakAdvisory(_ announcement: VoiceAnnouncement, onDone: @escaping PlaybackDone = { _ in }) {
    onGeigerQueue { player in
      guard player.presetVoiceEnabled else {
        onDone(.cancelled)
        return
      }
      player.announce(priority: .advisory, onDone: onDone) { [weak player] done in
        player?.speakVoiceTracked(announcement, slot: nil, done: done)
      }
    }
  }

  private func speakVoiceTracked(_ announcement: VoiceAnnouncement, slot: String?, done: PlaybackCompletion) {
    guard !isReleased else {
      done.finish(.cancelled)
      return
    }
    pendingSpeech?.cancel()
    pendingSpeech = nil
    playback.claimSpeech(done)
    let generation = nextSpeechGeneration()
    let lead = clipKey(slot ?? announcement.severity.slot)
    let leadEnd = LeadEnd()
    play(lead) { outcome in
      if leadEnd.noLine { done.finish(outcome) } else { leadEnd.outcome = outcome }
    }
    guard let line = joinedVoice(announcement, pack: voicePack()) else {
      geigerQueue.async {
        if let outcome = leadEnd.outcome { done.finish(outcome) } else { leadEnd.noLine = true }
      }
      return
    }
    let delay = speechDelayMs(clipDurationMs(lead))
    pendingSpeech = scheduler.postDelayed(delay) { [weak self] in
      self?.onGeigerQueue { owner in
        guard owner.isCurrentSpeech(generation) else { return }
        owner.synthesizer.stopSpeaking(at: .immediate)
        owner.stopVoiceOnQueue()
        let idle = owner.idleRequested || !owner.started
        owner.voiceNode = owner.playBufferOnQueue(
          line, label: "voice/\(announcement.key ?? "")", requestedAt: DispatchTime.now()
        ) { done.finish($0) }
        if owner.voiceNode == nil { done.finish(.failed) }
        if idle { owner.idleRequested = true }
      }
    }
  }

  private func stopVoiceOnQueue() {
    if let voiceNode { returnNode(voiceNode) }
    voiceNode = nil
  }

  private func voiceManifest(_ pack: String) -> VoicePackManifest? {
    voiceLock.lock()
    defer { voiceLock.unlock() }
    if let cached = voiceManifests[pack] { return cached }
    guard let root = packsRoot, let manifest = voicePackManifest(root: root, pack: pack) else { return nil }
    voiceManifests[pack] = manifest
    return manifest
  }

  private func voiceClip(_ pack: String, _ file: String) -> AVAudioPCMBuffer? {
    let key = "\(pack)/\(file)"
    voiceLock.lock()
    if let cached = voiceClips[key] { voiceLock.unlock(); return cached }
    voiceLock.unlock()
    // intentional-suppression: an undecodable clip is left out of the line
    guard let root = packsRoot,
      let audio = try? AVAudioFile(forReading: root.appendingPathComponent("voice-\(pack)/\(file)")),
      let decoded = convertToStandard(file: audio, standardFormat: makeStandardFormat()),
      let samples = decoded.floatChannelData?[0]
    else { return nil }
    let frames = Int(decoded.frameLength)
    let skip = leadingSilenceFrames(
      UnsafeBufferPointer(start: samples, count: frames),
      maxFrames: Int(voicePrimingMaxSeconds * decoded.format.sampleRate)
    )
    guard let trimmed = AVAudioPCMBuffer(pcmFormat: decoded.format, frameCapacity: AVAudioFrameCount(frames - skip)),
      let target = trimmed.floatChannelData?[0]
    else { return nil }
    target.update(from: samples + skip, count: frames - skip)
    trimmed.frameLength = AVAudioFrameCount(frames - skip)
    voiceLock.lock()
    voiceClips[key] = trimmed
    voiceLock.unlock()
    return trimmed
  }

  private func prewarmVoice(_ pack: String) {
    guard let manifest = voiceManifest(pack) else { return }
    let id = voicePackIds.contains(pack) ? pack : voicePackFallback
    for line in manifest.lines.values { for file in line.files { _ = voiceClip(id, file) } }
  }

  private func joinedVoice(_ spoken: VoiceAnnouncement, pack: String) -> AVAudioPCMBuffer? {
    var announcement = spoken
    announcement.wording = VoiceWording(level: voiceLevel)
    let id = voicePackIds.contains(pack) ? pack : voicePackFallback
    guard let manifest = voiceManifest(id), let files = voicePicker.clips(manifest, announcement) else { return nil }
    let slot = "\(id)/\(announcement.key ?? "").\(announcement.severity.rawValue).\(announcement.wording.rawValue)"
    voiceLock.lock()
    let prepared = preparedVoice.removeValue(forKey: slot)
    voiceLock.unlock()
    let buffer = prepared?.files == files ? prepared?.buffer : concatVoice(id, files)
    DispatchQueue.global(qos: .utility).async { [weak self] in
      guard let self, let next = self.voicePicker.next(manifest, announcement),
        let joined = self.concatVoice(id, next)
      else { return }
      self.voiceLock.lock()
      self.preparedVoice[slot] = (next, joined)
      self.voiceLock.unlock()
    }
    return buffer
  }

  private func concatVoice(_ pack: String, _ files: [String]) -> AVAudioPCMBuffer? {
    let clips = files.compactMap { voiceClip(pack, $0) }
    guard let format = clips.first?.format else { return nil }
    let total = clips.reduce(0) { $0 + $1.frameLength }
    guard total > 0, let joined = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: total),
      let target = joined.floatChannelData?[0]
    else { return nil }
    var offset = 0
    for clip in clips {
      guard let source = clip.floatChannelData?[0] else { continue }
      (target + offset).update(from: source, count: Int(clip.frameLength))
      offset += Int(clip.frameLength)
    }
    joined.frameLength = AVAudioFrameCount(offset)
    return joined
  }

  func preview(spec: String, distanceUnit: String = "km", temperatureUnit: String = "celsius") {
    guard !isReleased else { return }
    Self.log("AlertAudioPlayer.preview: \(spec)")
    if let sound = parseVoiceAlertSound(spec) {
      speakVoice(
        voiceAnnouncement(sound, controlId: nil, reading: nil, percentAvailable: true, distanceUnit: distanceUnit, temperatureUnit: temperatureUnit)
      )
      return
    }
    if let tts = parseTtsAlertSound(spec) {
      let text = renderAlertMessageTemplate(
        tts.text,
        alert: ttsSampleAlert(spec: spec),
        batteryPercent: 42.0,
        distanceUnit: distanceUnit
      )
      Self.log("AlertAudioPlayer.preview TTS text='\(text)'")
      if !text.isEmpty { speakAfterSeverity(tts.severity, text: text) }
      return
    }
    let key = clipKey(previewSlot(spec), my: mySoundId(spec))
    Self.log("AlertAudioPlayer.preview resolved=\(key)")
    play(key)
  }

  func updateGeiger(ruleId: String, spec: String, rangeDepth: Double) {
    guard !isReleased else { return }
    geigerQueue.async { [weak self] in
      guard let self, !self.isReleased else { return }
      self.updateGeigerSync(ruleId: ruleId, spec: spec, rangeDepth: rangeDepth)
    }
  }

  private func updateGeigerSync(ruleId: String, spec: String, rangeDepth: Double) {
    let depth = min(max(rangeDepth, 0.0), 1.0)
    let tickKey = clipKey(geigerSlot(spec), my: mySoundId(spec))
    let existing = geigerLoops[ruleId]

    if depth >= 1.0 {
      existing?.workItem?.cancel()
      if existing?.sustained == true && existing?.sustainedPlaying == true && existing?.sustainedKey == tickKey {
        return
      }
      stopSustained(ruleId: ruleId)
      let loop = GeigerLoop(spec: spec, rangeDepth: depth, sustained: true)
      geigerLoops[ruleId] = loop
      scheduleSustainedLoop(loop: loop, ruleId: ruleId, clipKey: tickKey)
      return
    }

    if existing?.sustained == true {
      stopSustained(ruleId: ruleId)
    }
    if let existing, !existing.sustained, existing.spec == spec {
      existing.rangeDepth = depth
      return
    }
    existing?.workItem?.cancel()
    let loop = GeigerLoop(spec: spec, rangeDepth: depth, sustained: false)
    geigerLoops[ruleId] = loop
    scheduleGeigerTick(loop: loop, ruleId: ruleId, slot: geigerSlot(spec))
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

  private func scheduleGeigerTick(loop: GeigerLoop, ruleId: String, slot: String) {
    let startDepth = max(0, loop.rangeDepth)
    let startDelay = geigerIntervalMs(rangeDepth: startDepth)
    scheduleGeigerTick(loop: loop, ruleId: ruleId, slot: slot, delayMs: startDelay)
  }

  private func scheduleGeigerTick(loop: GeigerLoop, ruleId: String, slot: String, delayMs: Int) {
    loop.workItem = scheduler.postDelayed(Int64(delayMs)) { [weak self] in
      self?.onGeigerQueue { owner in
        guard let existing = owner.geigerLoops[ruleId], existing === loop, !existing.sustained else { return }
        owner.playOnQueue(owner.clipKey(slot, my: mySoundId(loop.spec)))
        let interval = owner.geigerIntervalMs(rangeDepth: loop.rangeDepth)
        owner.scheduleGeigerTick(loop: loop, ruleId: ruleId, slot: slot, delayMs: interval)
      }
    }
  }

  private func scheduleSustainedLoop(loop: GeigerLoop, ruleId: String, clipKey: String) {
    let token = UUID()
    loop.sustainToken = token
    loop.sustainedKey = clipKey
    scheduleSustainedBuffer(loop: loop, ruleId: ruleId, clipKey: clipKey, token: token)
  }

  private func scheduleSustainedBuffer(loop: GeigerLoop, ruleId: String, clipKey: String, token: UUID) {
    guard let buffer = buffer(clipKey) else { return }
    startIfNeeded()
    let leased = loop.sustainedNode ?? leaseNode(format: buffer.format)
    let node = leased.node
    loop.sustainedNode = leased
    loop.sustainedPlaying = true
    node.scheduleBuffer(buffer, at: nil, options: [], completionHandler: { [weak self] in
      self?.geigerQueue.async {
        guard let self else { return }
        guard
          let current = self.geigerLoops[ruleId],
          current === loop, current.sustainToken == token
        else {
          self.returnNode(leased)
          return
        }
        self.scheduleSustainedBuffer(loop: loop, ruleId: ruleId, clipKey: clipKey, token: token)
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
    loop.sustainToken = nil
    loop.sustainedPlaying = false
    if let leased = loop.sustainedNode {
      returnNode(leased)
      loop.sustainedNode = nil
    }
  }

  private func geigerIntervalMs(rangeDepth: Double) -> Int {
    let clipped = min(max(rangeDepth, 0.0), 1.0)
    return Int(max(60, min(800, 800 - Int(740 * clipped))))
  }

  private func speakTracked(_ text: String, done: PlaybackCompletion) {
    guard !isReleased else {
      done.finish(.cancelled)
      return
    }
    let reactivate = { [self] in
      idleRequested = false
      stopVoiceOnQueue()
      // intentional-suppression: a refused activation degrades to silence, never a crash
      try? activateSession()
    }
    if DispatchQueue.getSpecific(key: Self.geigerQueueMarker) == ObjectIdentifier(self) {
      reactivate()
    } else {
      geigerQueue.sync(execute: reactivate)
    }
    let utterance = AVSpeechUtterance(string: text)
    utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
    utterance.preUtteranceDelay = 0
    speechCompletions.register(utterance, done)
    synthesizer.stopSpeaking(at: .immediate)
    synthesizer.speak(utterance)
  }

  func vibrate(rangeDepth: Double?) {
    guard !isReleased else { return }
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

  func release() {
    guard markReleased() else { return }
    playback.cancelAll()
    speechCompletions.clear()
    synthesizer.stopSpeaking(at: .immediate)
    if DispatchQueue.getSpecific(key: Self.geigerQueueMarker) == ObjectIdentifier(self) {
      releaseOnQueue()
    } else {
      geigerQueue.sync { releaseOnQueue() }
    }
    releaseAudioSession()
  }

  private func releaseOnQueue() {
    clearAnnouncementsOnQueue()
    for loop in geigerLoops.values {
      loop.workItem?.cancel()
      stopSustainedPlaybackForLoop(loop)
    }
    geigerLoops.removeAll(keepingCapacity: true)
    for (node, _) in attachedNodes.values {
      node.stop()
      detachPlayerNode(node)
    }
    attachedNodes.removeAll()
    idleNodes.removeAll()
    nodeLeases.removeAll()
    voiceNode = nil
    activeOneShotNodes.removeAll(keepingCapacity: true)
    if engine.isRunning { engine.stop() }
    started = false
    buffersBySlot.removeAll(keepingCapacity: true)
  }

  private func play(_ clipKey: String, onDone: PlaybackDone? = nil) {
    guard !isReleased else {
      onDone?(.cancelled)
      return
    }
    let requestedAt = DispatchTime.now()
    geigerQueue.async { [weak self] in
      self?.playOnQueue(clipKey, requestedAt: requestedAt, onDone: onDone)
    }
  }

  private func playOnQueue(_ clipKey: String, requestedAt: DispatchTime = .now(), onDone: PlaybackDone? = nil) {
    guard !isReleased else {
      onDone?(.cancelled)
      return
    }
    guard let buffer = buffer(clipKey) else {
      Self.log("AlertAudioPlayer.play: NO BUFFER for \(clipKey)")
      onDone?(.failed)
      return
    }
    playBufferOnQueue(buffer, label: clipKey, requestedAt: requestedAt, onDone: onDone)
  }

  @discardableResult
  private func playBufferOnQueue(
    _ buffer: AVAudioPCMBuffer,
    label: String,
    requestedAt: DispatchTime,
    onDone: PlaybackDone? = nil
  ) -> LeasedNode? {
    guard !isReleased else {
      onDone?(.cancelled)
      return nil
    }
    startIfNeeded()
    let leased = leaseNode(format: buffer.format)
    let node = leased.node
    activeOneShotNodes.append(node)
    node.scheduleBuffer(buffer, at: nil, options: [], completionHandler: { [weak self] in
      guard let self else { return }
      self.geigerQueue.async {
        self.returnNode(leased)
        self.idleIfQuietOnQueue()
        onDone?(.completed)
      }
    })
    node.play()
    reportLatency(label, requestedAt: requestedAt)
    return leased
  }

  private func reportLatency(_ sound: String, requestedAt: DispatchTime) {
    let latencyMs = Int64((DispatchTime.now().uptimeNanoseconds - requestedAt.uptimeNanoseconds) / 1_000_000)
    guard latencyMs >= alertAudioLatencyReportMs, lateReported.insert(sound).inserted else { return }
    onDiagnostic("alert_audio_latency", ["sound": sound, "latency_ms": latencyMs, "path": "ready"])
  }

  private func leaseNode(format: AVAudioFormat) -> LeasedNode {
    let node: AVAudioPlayerNode
    if let index = idleNodes.firstIndex(where: { attachedNodes[ObjectIdentifier($0)]?.format == format }) {
      node = idleNodes.remove(at: index)
    } else {
      node = AVAudioPlayerNode()
      engine.attach(node)
      engine.connect(node, to: engine.mainMixerNode, format: format)
      attachedNodes[ObjectIdentifier(node)] = (node, format)
    }
    let lease = UUID()
    nodeLeases[ObjectIdentifier(node)] = lease
    return LeasedNode(node: node, lease: lease)
  }

  private func returnNode(_ leased: LeasedNode) {
    let id = ObjectIdentifier(leased.node)
    guard nodeLeases[id] == leased.lease else { return }
    nodeLeases[id] = nil
    activeOneShotNodes.removeAll { $0 === leased.node }
    guard leased.node.engine != nil else {
      attachedNodes[id] = nil
      return
    }
    leased.node.stop()
    if idleNodes.count < Self.idleNodeLimit {
      idleNodes.append(leased.node)
    } else {
      detachPlayerNode(leased.node)
      attachedNodes[id] = nil
    }
  }

  private func detachPlayerNode(_ node: AVAudioPlayerNode) {
    guard node.engine != nil else {
      Self.log("AlertAudioPlayer.detachPlayerNode: already detached, skipping")
      return
    }
    engine.disconnectNodeOutput(node)
    engine.detach(node)
  }
}

private final class LeadEnd {
  var outcome: PlaybackOutcome?
  var noLine = false
}

/// @platform-diff Android finishes utterances from `UtteranceProgressListener` by utterance id.
private final class SpeechCompletions: NSObject, AVSpeechSynthesizerDelegate {
  private var byUtterance: [ObjectIdentifier: PlaybackCompletion] = [:]
  private let lock = NSLock()

  func register(_ utterance: AVSpeechUtterance, _ done: PlaybackCompletion) {
    lock.lock()
    byUtterance[ObjectIdentifier(utterance)] = done
    lock.unlock()
  }

  func clear() {
    lock.lock()
    byUtterance.removeAll()
    lock.unlock()
  }

  private func end(_ utterance: AVSpeechUtterance, _ outcome: PlaybackOutcome) {
    lock.lock()
    let done = byUtterance.removeValue(forKey: ObjectIdentifier(utterance))
    lock.unlock()
    done?.finish(outcome)
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    end(utterance, .completed)
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    end(utterance, .cancelled)
  }
}
