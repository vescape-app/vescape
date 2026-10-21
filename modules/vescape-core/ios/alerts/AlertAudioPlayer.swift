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

/// Sounds the alert form offers: the active effects pack's severities for single alerts, geiger
/// ticks for range alerts.
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

/// Slot a one-shot preview of `soundType` plays: a geiger tick, or the severity sound once.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/EffectsPacks.kt `previewSlot`
internal func previewSlot(_ soundType: String) -> String {
  isGeigerSoundType(soundType) ? geigerSlot(soundType) : parseSlotAlertSound(soundType).severity.slot
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
    firedAt: alertNowMs()
  )
}

private func alertNowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

/// One running geiger loop for a rule. Sustained loops a buffer continuously; ticking re-arms a
/// timer whose interval depends on the current `rangeDepth`.
private final class GeigerLoop {
  let soundType: String
  let pin: PresetSoundPin?
  var rangeDepth: Double
  let sustained: Bool
  var workItem: Cancellable?
  /// Token used to cancel the sustained re-schedule cycle. A still-registered token with the same
  /// UUID means the completion-handler should keep looping; a changed/removed loop stops it.
  var sustainToken: UUID?
  var sustainedPlaying = false
  var sustainedNode: AVAudioPlayerNode?

  init(soundType: String, pin: PresetSoundPin?, rangeDepth: Double, sustained: Bool) {
    self.soundType = soundType
    self.pin = pin
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
/// instead of `SoundPool`; geiger tick scheduling uses a dedicated dispatch-backed scheduler;
/// sustained loops schedule the buffer with a completion callback instead of SoundPool
/// loop index. TTS uses `AVSpeechSynthesizer` instead of Android `TextToSpeech`.
/// Android's alarm/media stream setting has no iOS equivalent; this player retains its playback session.
internal final class AlertAudioPlayer {
  private static let audioSessionLock = NSLock()
  private static var audioSessionOwnerCount = 0

  private let engine = AVAudioEngine()
  private static let geigerQueueMarker = DispatchSpecificKey<ObjectIdentifier>()
  private let geigerQueue: DispatchQueue
  private let scheduler: Scheduler
  private let synthesizer = AVSpeechSynthesizer()
  private let assetsDirectory: URL?
  /// Decoded clip per `"<pack>/<slot>"` of every built-in effects pack.
  private var buffersBySlot: [String: AVAudioPCMBuffer] = [:]
  /// Length of each clip in `buffersBySlot`, written once in `init` and only read afterwards.
  private var clipDurationsMs: [String: Int64] = [:]
  /// Decoded My sound per `"my/<file>"`, loaded on first play (nil when it failed to decode). Read
  /// from any thread, so it carries its own lock.
  private var myBuffers: [String: AVAudioPCMBuffer?] = [:]
  private let myBuffersLock = NSLock()
  var soundPack = "retro"
  private var voice = voiceMatching
  private var voiceLevel = voiceLevelDefault
  /// Folder holding `effects-<id>/` and `voice-<id>/`; nil when the bundle is missing.
  private var packsRoot: URL?
  /// Voice each effects pack names, read once in `init`.
  private var effectsVoices: [String: String] = [:]
  /// Parsed voice pack manifests and decoded clips (`"<pack>/<file>"`), filled on first use from
  /// any thread, so they carry their own lock.
  private var voiceManifests: [String: VoicePackManifest] = [:]
  private var voiceClips: [String: AVAudioPCMBuffer] = [:]
  private let voiceLock = NSLock()
  private let voicePicker = VoiceVariantPicker()
  /// Next announcement's buffer per line (`"<pack>/<key>.<severity>"`), joined ahead. Guarded by
  /// `voiceLock`.
  private var preparedVoice: [String: (files: [String], buffer: AVAudioPCMBuffer)] = [:]
  /// Voice line playing now; a newer line stops it. Owned by `geigerQueue`.
  private var voiceNode: AVAudioPlayerNode?
  private var geigerLoops: [String: GeigerLoop] = [:]
  private var activeOneShotNodes: [AVAudioPlayerNode] = []
  private var started = false
  /// A `goIdle()` waiting for in-flight sound to finish. Guarded by `geigerQueue`.
  private var idleRequested = false
  private var ownsAudioSession = false
  /// `released` is read from any thread (bridge, main, geiger queue) so it carries its own lock
  /// rather than riding on `geigerQueue`; every other mutable field below is owned by `geigerQueue`.
  private let releasedLock = NSLock()
  private var released = false

  /// `assetsDirectory` overrides the bundled `VescapeCoreAssets.bundle/alert-packs` lookup with a
  /// folder holding `effects-<id>/pack.json`. Production passes nil; the SPM test target has no
  /// resource bundle and points at the repo's `shared/alerts/packs` so the engine graph is exercised
  /// for real.
  init(
    assetsDirectory: URL? = nil,
    outputVolume: Float = 1,
    geigerQueue: DispatchQueue = DispatchQueue(label: "vescape.alerts.geiger", qos: .userInitiated),
    scheduler: Scheduler? = nil
  ) {
    self.assetsDirectory = assetsDirectory
    self.geigerQueue = geigerQueue
    self.scheduler = scheduler ?? DispatchQueueScheduler(queue: geigerQueue)
    geigerQueue.setSpecific(key: Self.geigerQueueMarker, value: ObjectIdentifier(self))
    acquireAudioSession()
    let standardFormat = makeStandardFormat()
    engine.mainMixerNode.outputVolume = outputVolume
    do {
      try engine.start()
      started = true
      Self.log("AlertAudioPlayer: engine started (format=\(standardFormat.sampleRate)Hz ch=\(standardFormat.channelCount) common=\(standardFormat.isStandard))")
    } catch {
      // Without the engine alerts stay silent, but the app keeps running. Sessions rarely fail
      // to start once the session is configured; a later play call will retry start (`startIfNeeded`).
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

  /// True once `release()` has run. Safe to read from any thread.
  private var isReleased: Bool {
    releasedLock.lock()
    defer { releasedLock.unlock() }
    return released
  }

  /// Scheduler callbacks may be virtual in tests, but audio state always belongs to this queue.
  private func onGeigerQueue(_ block: @escaping (AlertAudioPlayer) -> Void) {
    geigerQueue.async { [weak self] in
      guard let self, !self.isReleased else { return }
      block(self)
    }
  }

  /// Flip `released` once; returns false when another caller already released.
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
    // Sound is wanted again; a pending idle must not fire behind it.
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

  /// Re-activating an already-active session is a cheap no-op, so this is safe on every play path
  /// and is the only thing standing between an idled player and audible sound.
  private func activateSession() throws {
    try AVAudioSession.sharedInstance().setActive(true, options: [])
  }

  /// Stand down between Board Sessions without tearing the player down.
  ///
  /// A running `AVAudioEngine` holds a render thread, and an active `.playback` session is what tells
  /// iOS the app still needs the `audio` background mode — together they keep the process awake long
  /// after the ride that wanted them ended. Unlike `release()` this is reversible: buffers, nodes and
  /// the loaded sound bank all survive, so the next alert costs a session activation and an engine
  /// start rather than a rebuild, and nothing about alert latency mid-ride changes.
  ///
  /// @platform-diff iOS-only. Android's `AlertEngine` plays through `SoundPool`, which is idle
  /// between plays and holds no session or render thread, so it has nothing to stand down from.
  func goIdle() {
    geigerQueue.async { [weak self] in
      guard let self, !self.isReleased else { return }
      self.idleRequested = true
      self.idleIfQuietOnQueue()
    }
  }

  /// Must run on `geigerQueue`.
  ///
  /// Deferred rather than abandoned when sound is still playing. A teardown normally enqueues the
  /// disconnect one-shot *before* `goIdle`, so on the common path the node is still registered here
  /// — dropping the request there would mean the engine never idles at all. The one-shot's
  /// completion re-runs this once the node drains.
  private func idleIfQuietOnQueue() {
    guard idleRequested, !isReleased else { return }
    // A geiger loop still ticking means a ride is still alerting; idling under it would cut the
    // rider's audio off mid-session.
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

  /// Key of `slot` in the active (or given) effects pack.
  private func slotKey(_ slot: String, pack: String? = nil) -> String {
    "\(effectsPackId(pack ?? soundPack))/\(slot)"
  }

  /// Key `slot` plays from: My sound `my` when it still exists, else the slot's override, else the
  /// pack's clip. A missing or undecodable My sound falls back to the pack, never silence.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/EffectsPacks.kt `slotClip`
  private func clipKey(_ slot: String, my: String? = nil, pack: String? = nil) -> String {
    if let url = my.flatMap(MySounds.file) ?? MySounds.overrideFile(slot), let key = myBufferKey(url) { return key }
    return slotKey(slot, pack: pack)
  }

  /// Key of the decoded My sound at `url`, decoding it on first use; nil when it cannot decode.
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

  // MARK: - Settings

  /// Apply the app's sound settings: effects pack, voice, and voice level. Prewarms the voice lines.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `setSoundSettings`
  func applySoundSettings(_ settings: [String: Any?]) {
    soundPack = settings["soundPack"] as? String ?? soundPack
    voice = settings["voice"] as? String ?? voice
    voiceLevel = settings["voiceLevel"] as? String ?? voiceLevel
    let pack = voicePack()
    DispatchQueue.global(qos: .utility).async { [weak self] in self?.prewarmVoice(pack) }
  }

  /// Effects pack a sound plays from: the preset's `pin`, else the app-wide one.
  private func effectsPack(_ pin: PresetSoundPin?) -> String { pin?.effects ?? soundPack }

  /// Voice pack a line speaks with: the preset's `pin`, else the `voice` setting, where Matching
  /// follows the effects pack the same sound plays from.
  private func voicePack(_ pin: PresetSoundPin? = nil) -> String {
    pin?.voice ?? voicePackId(voice, effectsVoice: effectsVoices[effectsPackId(effectsPack(pin))])
  }

  // MARK: - Connection sounds

  func playConnect() {
    playAppCue("on")
  }

  func playDisconnect() {
    playAppCue("off")
  }

  /// Play when the Board Session ride ends.
  func playRideEnd() {
    playAppCue("ride.end")
  }

  /// Play app cue `cue` from the active effects pack; at Voice level `full` its voice line follows
  /// once the effect has finished. Standard and Off play the effect only.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `playAppCue`
  func playAppCue(_ cue: String) {
    guard let slot = appCueSlot(cue) else { return }
    if voiceLevel == "full", let key = appCueVoiceKey(cue) {
      speakVoice(VoiceAnnouncement(severity: .info, key: key, value: nil), slot: slot)
    } else {
      play(clipKey(slot))
    }
  }

  /// Settings preview of `pack`'s clip for `cue`: the effect only, whatever the Voice level.
  func playAppSound(pack: String, cue: String) {
    guard let slot = appCueSlot(cue) else { return }
    play(clipKey(slot, pack: pack))
  }

  // MARK: - Single

  /// Play one announcement: an `alert(count):severity` rule's severity sound from the active
  /// effects pack, `count` times, `alertBeepSpacingMs` apart.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `playSingle`
  func playSingle(soundType: String, pin: PresetSoundPin? = nil) {
    playSeverity(parseSlotAlertSound(soundType), my: mySoundId(soundType), pack: effectsPack(pin))
  }

  /// `sound`'s severity slot from `pack`, or My sound `my` in its place, `sound.count` times.
  private func playSeverity(_ sound: SlotAlertSound, my: String? = nil, pack: String? = nil) {
    guard !isReleased else { return }
    let key = clipKey(sound.severity.slot, my: my, pack: pack)
    play(key)
    guard sound.count > 1 else { return }
    // A sound longer than the spacing (a pack's multi-beep severity) repeats once it ends.
    let duration = Double(clipDurationMs(key))
    let interval = duration > alertBeepSpacingMs ? duration + alertBeepSpacingMs : alertBeepSpacingMs
    for index in 1..<sound.count {
      scheduler.postDelayed(Int64(interval * Double(index))) { [weak self] in
        self?.onGeigerQueue { $0.playOnQueue(key) }
      }
    }
  }

  // MARK: - Preview

  /// Speak a TTS rule's `text` after its `severity` sound, played once; speech starts once the
  /// sound has finished, so the two never overlap.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `speakAfterSeverity`
  func speakAfterSeverity(_ severity: AlertSeverity, text: String) {
    guard !isReleased else { return }
    // A newer announcement supersedes speech still waiting out an older one's sound.
    pendingSpeech?.cancel()
    let generation = nextSpeechGeneration()
    playSeverity(SlotAlertSound(count: 1, severity: severity))
    // Written only from the announcing caller; cancelling an already-run item is a no-op.
    let delay = max(alertSpeechDelayMs, clipDurationMs(clipKey(severity.slot)))
    pendingSpeech = scheduler.postDelayed(delay) { [weak self] in
      guard let self, self.isCurrentSpeech(generation) else { return }
      self.speakMessage(text)
    }
  }

  private var pendingSpeech: Cancellable?
  /// Bumped per spoken announcement; speech whose timer already fired checks it before starting,
  /// so a newer announcement supersedes it even after cancellation comes too late.
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

  /// False at Voice level `off`: preset voice rules then play their severity sound only.
  var presetVoiceEnabled: Bool { voiceLevel != "off" }

  /// Speak `announcement`: `slot` (its severity sound by default) once, then the voice pack line
  /// joined with its value into one buffer, starting once the sound has finished. A key the pack has
  /// no line for plays the sound only. Voice level is the caller's (`presetVoiceEnabled`). A preset's
  /// `pin` picks the packs both play from.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `speakVoice`
  func speakVoice(_ announcement: VoiceAnnouncement, slot: String? = nil, pin: PresetSoundPin? = nil) {
    guard !isReleased else { return }
    pendingSpeech?.cancel()
    pendingSpeech = nil
    let generation = nextSpeechGeneration()
    let lead = clipKey(slot ?? announcement.severity.slot, pack: effectsPack(pin))
    play(lead)
    guard let line = joinedVoice(announcement, pack: voicePack(pin)) else { return }
    let delay = max(alertSpeechDelayMs, clipDurationMs(lead))
    pendingSpeech = scheduler.postDelayed(delay) { [weak self] in
      self?.onGeigerQueue { owner in
        guard owner.isCurrentSpeech(generation) else { return }
        owner.synthesizer.stopSpeaking(at: .immediate)
        owner.stopVoiceOnQueue()
        // A `goIdle()` pending or already done behind the lead sound (a disconnect, a ride end)
        // still applies: the line restarts the engine, so stand it down again once the line ends.
        let idle = owner.idleRequested || !owner.started
        owner.voiceNode = owner.playBufferOnQueue(line, label: "voice/\(announcement.key ?? "")")
        if idle { owner.idleRequested = true }
      }
    }
  }

  /// Must run on `geigerQueue`. A finished line's node is already detached and needs no stop.
  private func stopVoiceOnQueue() {
    if let node = voiceNode, node.engine != nil { node.stop() }
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

  /// Decoded clip `file` of `pack`, leading padding trimmed; nil when it cannot decode.
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

  /// Decode every line clip of `pack` ahead of the first announcement. Value clips decode on use.
  private func prewarmVoice(_ pack: String) {
    guard let manifest = voiceManifest(pack) else { return }
    let id = voicePackIds.contains(pack) ? pack : voicePackFallback
    for line in manifest.lines.values { for file in line.start + line.end where !file.isEmpty { _ = voiceClip(id, file) } }
  }

  /// `announcement` joined into one buffer from `pack`, or nil when the pack has no line for its key.
  /// The next pick joins right after on a utility queue, so its variant costs the next announcement
  /// nothing.
  private func joinedVoice(_ announcement: VoiceAnnouncement, pack: String) -> AVAudioPCMBuffer? {
    let id = voicePackIds.contains(pack) ? pack : voicePackFallback
    guard let manifest = voiceManifest(id), let files = voicePicker.clips(manifest, announcement) else { return nil }
    let slot = "\(id)/\(announcement.key ?? "").\(announcement.severity.rawValue)"
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

  /// Play a preset once for UI preview, or speak a `tts` template with a sample fired alert after
  /// its severity sound.
  func preview(soundType: String, unitSystem: String = "metric") {
    guard !isReleased else { return }
    Self.log("AlertAudioPlayer.preview: \(soundType)")
    if let sound = parseVoiceAlertSound(soundType) {
      speakVoice(
        voiceAnnouncement(sound, controlId: nil, threshold: nil, percentAvailable: true, unitSystem: unitSystem)
      )
      return
    }
    if let tts = parseTtsAlertSound(soundType) {
      let text = renderAlertMessageTemplate(
        tts.text,
        alert: ttsSampleAlert(soundType: soundType),
        batteryPercent: 42.0,
        unitSystem: unitSystem
      )
      Self.log("AlertAudioPlayer.preview TTS text='\(text)'")
      if !text.isEmpty { speakAfterSeverity(tts.severity, text: text) }
      return
    }
    let key = clipKey(previewSlot(soundType), my: mySoundId(soundType))
    Self.log("AlertAudioPlayer.preview resolved=\(key)")
    play(key)
  }

  // MARK: - Geiger

  func updateGeiger(ruleId: String, soundType: String, rangeDepth: Double, pin: PresetSoundPin? = nil) {
    guard !isReleased else { return }
    geigerQueue.async { [weak self] in
      // Re-check on the queue: `release()` can land between the check above and this block, and a
      // loop created afterwards would re-arm its tick forever against a torn-down engine.
      guard let self, !self.isReleased else { return }
      self.updateGeigerSync(ruleId: ruleId, soundType: soundType, rangeDepth: rangeDepth, pin: pin)
    }
  }

  private func updateGeigerSync(ruleId: String, soundType: String, rangeDepth: Double, pin: PresetSoundPin?) {
    let depth = min(max(rangeDepth, 0.0), 1.0)
    let tickKey = clipKey(geigerSlot(soundType), my: mySoundId(soundType), pack: effectsPack(pin))
    let existing = geigerLoops[ruleId]

    if depth >= 1.0 {
      existing?.workItem?.cancel()
      if existing?.sustained == true && existing?.sustainedPlaying == true {
        return
      }
      stopSustained(ruleId: ruleId)
      let loop = GeigerLoop(soundType: soundType, pin: pin, rangeDepth: depth, sustained: true)
      geigerLoops[ruleId] = loop
      scheduleSustainedLoop(loop: loop, ruleId: ruleId, clipKey: tickKey)
      return
    }

    if existing?.sustained == true {
      stopSustained(ruleId: ruleId)
    }
    if let existing, !existing.sustained, existing.soundType == soundType, existing.pin == pin {
      existing.rangeDepth = depth
      return
    }
    existing?.workItem?.cancel()
    let loop = GeigerLoop(soundType: soundType, pin: pin, rangeDepth: depth, sustained: false)
    geigerLoops[ruleId] = loop
    scheduleGeigerTick(loop: loop, ruleId: ruleId, slot: geigerSlot(soundType))
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

  /// Each tick resolves `slot` (or the loop's My sound) afresh, so a pack switch mid-loop takes effect.
  private func scheduleGeigerTick(loop: GeigerLoop, ruleId: String, slot: String, delayMs: Int) {
    loop.workItem = scheduler.postDelayed(Int64(delayMs)) { [weak self] in
      self?.onGeigerQueue { owner in
        guard let existing = owner.geigerLoops[ruleId], existing === loop, !existing.sustained else { return }
        owner.playOnQueue(owner.clipKey(slot, my: mySoundId(loop.soundType), pack: owner.effectsPack(loop.pin)))
        let interval = owner.geigerIntervalMs(rangeDepth: loop.rangeDepth)
        owner.scheduleGeigerTick(loop: loop, ruleId: ruleId, slot: slot, delayMs: interval)
      }
    }
  }

  /// Loop the buffer continuously until the loop is cancelled by `stopGeiger`/`stopAllGeiger`.
  private func scheduleSustainedLoop(loop: GeigerLoop, ruleId: String, clipKey: String) {
    let token = UUID()
    loop.sustainToken = token
    scheduleSustainedBuffer(loop: loop, ruleId: ruleId, clipKey: clipKey, token: token)
  }

  private func scheduleSustainedBuffer(loop: GeigerLoop, ruleId: String, clipKey: String, token: UUID) {
    guard let buffer = buffer(clipKey) else { return }
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
    guard !isReleased else { return }
    // The synthesizer plays through the shared session, which an earlier `goIdle()` may have
    // deactivated; without this the utterance is silently dropped. Cancelling a pending idle and
    // re-activating happen on `geigerQueue` — the same queue `goIdle` runs on — so a teardown racing
    // an alert cannot deactivate the session out from under the utterance that follows.
    let reactivate = { [self] in
      idleRequested = false
      stopVoiceOnQueue()
      // intentional-suppression: a refused activation degrades to silence, never a crash
      try? activateSession()
    }
    // `sync` onto the current serial queue would deadlock, so run inline when already on it —
    // the same guard `release()` uses.
    if DispatchQueue.getSpecific(key: Self.geigerQueueMarker) == ObjectIdentifier(self) {
      reactivate()
    } else {
      geigerQueue.sync(execute: reactivate)
    }
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

  // MARK: - Release

  func release() {
    guard markReleased() else { return }
    synthesizer.stopSpeaking(at: .immediate)
    // Everything touching the engine graph or the node bookkeeping runs on `geigerQueue`, so a
    // completion handler queued behind this block sees the drained state (and a node whose
    // `engine` is already nil) instead of racing it. A queued closure strongifies `self` while it
    // runs, so the last reference can drop on `geigerQueue` and reach here through `deinit` —
    // `sync` onto the current serial queue would deadlock, so tear down inline in that case.
    if DispatchQueue.getSpecific(key: Self.geigerQueueMarker) == ObjectIdentifier(self) {
      releaseOnQueue()
    } else {
      geigerQueue.sync { releaseOnQueue() }
    }
    releaseAudioSession()
  }

  /// Must run on `geigerQueue`.
  private func releaseOnQueue() {
    for loop in geigerLoops.values {
      loop.workItem?.cancel()
      stopSustainedPlaybackForLoop(loop)
    }
    geigerLoops.removeAll(keepingCapacity: true)
    for node in activeOneShotNodes {
      node.stop()
      detachPlayerNode(node)
    }
    activeOneShotNodes.removeAll(keepingCapacity: true)
    if engine.isRunning { engine.stop() }
    started = false
    buffersBySlot.removeAll(keepingCapacity: true)
  }

  // MARK: - Low-level

  /// Entry point from any thread. Hops to `geigerQueue`, the single owner of the engine graph and
  /// of `activeOneShotNodes`.
  private func play(_ clipKey: String) {
    guard !isReleased else { return }
    geigerQueue.async { [weak self] in
      self?.playOnQueue(clipKey)
    }
  }

  /// Must run on `geigerQueue`.
  private func playOnQueue(_ clipKey: String) {
    guard !isReleased else { return }
    guard let buffer = buffer(clipKey) else {
      Self.log("AlertAudioPlayer.play: NO BUFFER for \(clipKey)")
      return
    }
    playBufferOnQueue(buffer, label: clipKey)
  }

  @discardableResult
  private func playBufferOnQueue(_ buffer: AVAudioPCMBuffer, label: String) -> AVAudioPlayerNode? {
    guard !isReleased else { return nil }
    startIfNeeded()
    Self.log("AlertAudioPlayer.play: schedule \(label) engine.running=\(engine.isRunning) frames=\(buffer.frameLength)")
    let node = makePlayerNode(format: buffer.format)
    activeOneShotNodes.append(node)
    node.scheduleBuffer(buffer, at: nil, options: [], completionHandler: { [weak self, weak node] in
      guard let self, let node else { return }
      self.geigerQueue.async {
        self.activeOneShotNodes.removeAll { $0 === node }
        self.detachPlayerNode(node)
        // A teardown may have asked to idle while this was still sounding.
        self.idleIfQuietOnQueue()
      }
    })
    node.play()
    return node
  }

  private func makePlayerNode(format: AVAudioFormat) -> AVAudioPlayerNode {
    let node = AVAudioPlayerNode()
    engine.attach(node)
    engine.connect(node, to: engine.mainMixerNode, format: format)
    return node
  }

  /// Detach is idempotent: `release()` and a pending completion handler can both reach the same
  /// node, and `disconnectNodeOutput` raises an ObjC `NSException` (uncatchable from Swift, so it
  /// aborts the process) when the node is no longer attached. `node.engine` is the attachment.
  /// Must run on `geigerQueue`.
  private func detachPlayerNode(_ node: AVAudioPlayerNode) {
    guard node.engine != nil else {
      Self.log("AlertAudioPlayer.detachPlayerNode: already detached, skipping")
      return
    }
    engine.disconnectNodeOutput(node)
    engine.detach(node)
  }
}
