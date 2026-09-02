import Foundation
import Network

/// What JS renders. Native owns every transition; JS only asks and shows.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncCoordinator.kt `SyncStatus`
struct SyncStatus {
  let accountId: String?
  let pendingRows: Int
  let activity: SyncActivity
  let pause: SyncPauseReason?
  let lastUploadAtMs: Int64?

  func toMap() -> [String: Any?] {
    [
      "accountId": accountId,
      "pendingRows": pendingRows,
      "activity": activity.slug,
      "pause": pause?.slug,
      "lastUploadAtMs": lastUploadAtMs,
    ]
  }
}

/// The uploader's lifecycle: the loop, the kicks, and the Account binding it runs under.
///
/// Runs inside the window the app already keeps alive — the existing background modes during a ride,
/// the foreground otherwise. Deliberately no `BGTaskScheduler`: a ride that ends offline on a phone
/// that is never reopened waits for the next app open or the next ride.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncCoordinator.kt
final class SyncCoordinator {
  static let shared = SyncCoordinator()

  internal static let syncPath = "/api/sync"

  /// Samples persisted this recently mean a ride is producing, Idle Pause included.
  private static let sampleActivityWindowMs: Int64 = 60_000

  /// A drain is a burst, not a loop that can never yield to the rest of the process.
  private static let maxDrainSteps = 50

  private let lock = NSLock()
  private var generation: Int64 = 0
  private var lastSamplePersistedAtMs: Int64 = 0
  private var lastUploadAtMs: Int64?
  private var wifiOnly = false
  /// The master switch. Off by default: nothing uploads until the Rider turns backup on.
  private var enabled = false
  private var onWifi = false
  private var online = true
  /// Failure keys already recorded this process, so a wedged batch writes one event, not a stream.
  private var recordedFailures = Set<String>()
  private var loop: Task<Void, Never>?
  /// Every pass chains onto this, so scan → send → commit never interleaves with another pass or
  /// with an Account reset. Cancelled by `stop()` together with the loop.
  private var chain: Task<Void, Never>?

  private let monitor = NWPathMonitor()
  private lazy var store = SyncStore(
    generation: { [weak self] in self?.currentGeneration() ?? 0 },
    onPermanentFailure: { [weak self] reason, detail in
      self?.recordPermanentFailure(reason, detail: detail)
    }
  )
  private lazy var engine = SyncEngine(
    source: store,
    transport: { [weak self] body in
      await self?.post(body) ?? .transient(reason: "stopped")
    },
    environment: { [weak self] in
      self?.environment() ?? SyncEnvironment(
        ridingSamples: false,
        enabled: false,
        online: false,
        wifiOnly: false,
        onWifi: false,
        credentialReady: false,
        onlineBlocked: true
      )
    }
  )

  private init() {
    monitor.pathUpdateHandler = { [weak self] path in
      guard let self else { return }
      let reachable = path.status == .satisfied
      self.lock.lock()
      let regained = reachable && !self.online
      self.online = reachable
      self.onWifi = path.usesInterfaceType(.wifi)
      self.lock.unlock()
      // Connectivity regained is one of the immediate kicks, next to ride end and sign-in.
      if regained { self.kick() }
    }
    monitor.start(queue: DispatchQueue(label: "app.vescape.sync.path"))
  }

  var pauseReason: SyncPauseReason? { engine.pauseReason }

  /// Wired by the module: every status transition, pushed to JS. Native owns the state; JS renders
  /// it and never derives one of its own.
  var onStatusChanged: (([String: Any?]) -> Void)?

  /// Last status handed out, so an unchanged status emits nothing and raises no second notification.
  private var publishedActivity: String?
  private var publishedPause: String?
  private var publishedPending: Int?
  private var publishedUploadAtMs: Int64?
  private var publishedAccountId: String?

  /// Recording persisted samples: the ride cadence follows sample production, not session presence.
  func notifySamplesPersisted(atMs: Int64 = telemetryNowMs()) {
    lock.lock()
    lastSamplePersistedAtMs = atMs
    lock.unlock()
  }

  /// The ride ended and its last samples are on disk. Called after the final flush, so the kick
  /// scans a complete ride rather than one missing its tail.
  ///
  /// This is the moment with the largest fresh backlog and the moment a Rider is most likely to open
  /// the app and look at the status line, which is why it does not wait for the next tick.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncCoordinator.kt `notifyRecordingStopped`
  func notifyRecordingStopped() {
    kick()
  }

  /// A Rider changed something durable and small — a Favorite pinned, renamed or unpinned. One row,
  /// created by hand, and the Rider is looking at the screen that says whether it is backed up, so a
  /// five-minute wait reads as the backup not working.
  ///
  /// Deliberately not wired to telemetry writes: those arrive at 2 Hz and already have the ride
  /// cadence. This is for edits a Rider makes, which are rare and individually visible.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncCoordinator.kt `notifyRiderEdit`
  func notifyRiderEdit() {
    kick()
  }

  /// The master switch, from the App Setting native owns. Off stops the loop outright — no scan, no
  /// request, no backoff, no pause notification — rather than leaving a loop that decides to do
  /// nothing every five minutes.
  func setEnabled(_ value: Bool) {
    lock.lock()
    let changed = enabled != value
    enabled = value
    lock.unlock()
    guard changed else { return }
    if value {
      start()
    } else {
      stop()
      // A switched-off uploader asks the Rider for nothing: an earlier pause is no longer theirs to
      // act on until they turn backup back on.
      SyncNotifier.shared.update(nil)
    }
    publishStatus()
  }

  /// The "Back up over Wi-Fi only" App Setting, pushed by `AppDataRepository` on every write and
  /// read back on launch. Native reads the setting itself — JS never carries the switch to the
  /// uploader.
  func setWifiOnly(_ enabled: Bool) {
    lock.lock()
    let changed = wifiOnly != enabled
    wifiOnly = enabled
    lock.unlock()
    guard changed else { return }
    kick()
    publishStatus()
  }

  func status() -> SyncStatus {
    lock.lock()
    let uploadedAt = lastUploadAtMs
    lock.unlock()
    let environment = environment()
    let pending = store.pendingCount()
    let pause = engine.pauseReason
    return SyncStatus(
      accountId: store.boundAccountId(),
      pendingRows: pending,
      activity: SyncPolicy.describe(
        SyncState(
          nowMs: telemetryNowMs(),
          pendingRows: pending,
          ridingSamples: environment.ridingSamples,
          enabled: environment.enabled,
          online: environment.online,
          wifiOnly: environment.wifiOnly,
          onWifi: environment.onWifi,
          credentialReady: environment.credentialReady,
          onlineBlocked: environment.onlineBlocked,
          pause: pause,
          // Backoff is invisible to the Rider: a batch waiting to be retried is still syncing.
          retryAtMs: 0
        )
      ),
      pause: pause,
      lastUploadAtMs: uploadedAt
    )
  }

  /// Emit the current status when it differs from the last one, and raise the notification a pause
  /// needs: a permanent failure does not resolve through ordinary retry, so a backup that stopped
  /// weeks ago must not wait for the Rider to open the social sheet.
  private func publishStatus() {
    let status = status()
    lock.lock()
    let unchanged = status.activity.slug == publishedActivity
      && status.pause?.slug == publishedPause
      && status.pendingRows == publishedPending
      && status.lastUploadAtMs == publishedUploadAtMs
      && status.accountId == publishedAccountId
    let previousPause = publishedPause
    publishedActivity = status.activity.slug
    publishedPause = status.pause?.slug
    publishedPending = status.pendingRows
    publishedUploadAtMs = status.lastUploadAtMs
    publishedAccountId = status.accountId
    lock.unlock()
    guard !unchanged else { return }
    if status.pause?.slug != previousPause { SyncNotifier.shared.update(status.pause) }
    onStatusChanged?(status.toMap())
  }

  /// Pick the uploader back up on a cold launch: the credential outlives the process, so a phone
  /// that was signed in stays signed in, and nothing else would ever start the loop again. Binding
  /// the stored Account is a no-op when this database already belongs to it, and cannot claim a
  /// database that belongs to another one.
  func resumeIfBound() {
    // The switch is a durable App Setting, so the uploader restores it before the first pass of this
    // process — otherwise a cold launch on mobile data would upload once before JS loaded.
    let settings = AppDataRepository.shared.getSettings()
    setWifiOnly(settings["syncWifiOnly"] as? Bool ?? false)
    // Binding still happens with the switch off — it is what makes this database's Account known,
    // and starting the loop is the only thing the switch gates.
    if let credential = DeviceCredentialStore.shared.read() {
      bindAccount(credential.accountId)
    }
    setEnabled((settings["syncEnabled"] as? Bool) ?? false)
    publishStatus()
  }

  func start() {
    lock.lock()
    let running = enabled
    lock.unlock()
    guard running, loop == nil else { return }
    loop = Task { [weak self] in
      while !Task.isCancelled {
        guard let self else { return }
        let waitMs = await self.serialized { await self.pass() }
        self.publishStatus()
        try? await Task.sleep(nanoseconds: UInt64(max(waitMs, 0)) * 1_000_000)
      }
    }
  }

  /// Stops the loop and every pass in flight, so nothing is left running over a replaced database.
  func stop() {
    loop?.cancel()
    loop = nil
    chain?.cancel()
    chain = nil
  }

  /// Connectivity regained, ride ended, sign-in: send now rather than waiting for the next tick.
  func kick() {
    lock.lock()
    let running = enabled
    lock.unlock()
    guard running else { return }
    guard loop != nil else { return start() }
    Task { [weak self] in
      guard let self else { return }
      _ = await self.serialized { await self.pass() }
      self.publishStatus()
    }
  }

  /// Runs `work` after whatever is already queued, so a scan, its request and its cursor commit
  /// always complete against one database — an Account reset waits its turn rather than landing in
  /// the middle.
  private func serialized<T>(_ work: @escaping () async -> T) async -> T {
    lock.lock()
    let previous = chain
    let task = Task<T, Never> {
      await previous?.value
      return await work()
    }
    // The chain only has to say "the previous link finished", so its own value is discarded.
    chain = Task { _ = await task.value }
    lock.unlock()
    return await task.value
  }

  /// One pass, draining while the server keeps accepting: a `200` with rows still pending sends
  /// again straight away, so a long backlog drains instead of trickling.
  private func pass() async -> Int64 {
    var drains = 0
    while drains < Self.maxDrainSteps {
      switch await engine.runOnce() {
      case .sent(_, let morePending):
        lock.lock()
        lastUploadAtMs = telemetryNowMs()
        lock.unlock()
        if !morePending { return interval() }
        drains += 1
      // Nothing was accepted, but the next attempt differs — a narrowed byte target.
      case .retry:
        drains += 1
      case .waiting(let untilMs):
        return min(max(untilMs - telemetryNowMs(), 0), SyncPolicy.backoffMaxMs)
      case .paused:
        return SyncPolicy.idleIntervalMs
      case .idle:
        return interval()
      }
    }
    // A drain that never finishes yields rather than spinning; the next tick resumes it.
    return SyncPolicy.rideIntervalMs
  }

  private func interval() -> Int64 {
    samplesProducing() ? SyncPolicy.rideIntervalMs : SyncPolicy.idleIntervalMs
  }

  private func samplesProducing() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return telemetryNowMs() - lastSamplePersistedAtMs < Self.sampleActivityWindowMs
  }

  private func currentGeneration() -> Int64 {
    lock.lock()
    defer { lock.unlock() }
    return generation
  }

  private func environment() -> SyncEnvironment {
    lock.lock()
    let reachable = online
    let wifi = onWifi
    let meteredOnly = wifiOnly
    let running = enabled
    lock.unlock()
    let status = AppStatusCoordinator.shared.current?.version.status
    return SyncEnvironment(
      ridingSamples: samplesProducing(),
      enabled: running,
      online: reachable,
      wifiOnly: meteredOnly,
      onWifi: wifi,
      credentialReady: DeviceCredentialStore.shared.read() != nil,
      onlineBlocked: status == .onlineBlocked || status == .appBlocked
    )
  }

  /// The Sync endpoints are Online Capabilities behind the App Status gate, and they authenticate
  /// with the shared Device Token, so the whole call goes through `VescapeApi`.
  private func post(_ body: String) async -> SyncResponse {
    let api = VescapeApi.forOrigin(AppStatusCoordinator.serverBaseUrl)
    guard let response = await api.exchange(.post, path: Self.syncPath, rawBody: body) else {
      return .transient(reason: "network")
    }
    switch response.status {
    case 200: return .accepted(body: response.body)
    case 401: return .unauthorized
    case 413: return .tooLarge
    case 429: return .rateLimited(retryAfterMs: retryAfterMs(response.headers))
    case 500...599: return .transient(reason: "http \(response.status)")
    case 400...499: return .invalid(status: response.status, error: errorSlug(response.body))
    // A `2xx` that is not the accepted map is a protocol failure, not a success to interpret.
    default: return .invalid(status: response.status, error: "unexpected-success")
    }
  }

  /// The server's own delay in seconds, or the first backoff step when it named none.
  private func retryAfterMs(_ headers: [String: String]) -> Int64 {
    guard let value = headers["retry-after"], let seconds = Int64(value.trimmingCharacters(in: .whitespaces))
    else { return SyncPolicy.backoffStartMs }
    return seconds * 1_000
  }

  private func errorSlug(_ body: String) -> String {
    guard let data = body.data(using: .utf8),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let error = json["error"] as? String, !error.isEmpty
    else { return "invalid-request" }
    return error
  }

  // Account binding — the Device Token exchange returns a stable server Account id, and the first
  // Account claims this database.

  /// Claim the local database for `accountId` when it is unbound or already belongs to it.
  ///
  /// False means a different Account: cursors are deliberately not reset over the existing rows,
  /// because that would upload the previous Account's Boards, Ride History, locations and settings
  /// to the new one. The Rider has to confirm the destructive reset first.
  @discardableResult
  func bindAccount(_ accountId: String) -> Bool {
    let bound = store.bindAccount(accountId)
    if bound {
      engine.resume()
      kick()
    }
    return bound
  }

  /// The Account change transition, in the one order that cannot leak data between Accounts: stop
  /// the loop, invalidate in-flight work, replace the database, clear cursors and pending actions,
  /// bind the new Account, then start again.
  ///
  /// The wipe is local maintenance and emits no Sync Actions to either Account — replacing the file
  /// removes the log with everything else.
  func resetForAccount(_ accountId: String) async throws {
    stop()
    // Queued behind any pass still in flight: one that started before `stop()` finishes its scan,
    // send and commit against the old database before the file is replaced, and none can start
    // midway through the transition.
    let outcome: Result<Void, Error> = await serialized { [self] in
      lock.lock()
      // Every in-flight response now belongs to a previous Account and can no longer commit.
      generation += 1
      recordedFailures.removeAll()
      lastUploadAtMs = nil
      lock.unlock()

      do {
        try TelemetryDatabase.replaceWithFreshDatabase()
        guard store.bindAccount(accountId) else {
          throw SyncStoreError.databaseUnavailable
        }
        engine.resume()
        return .success(())
      } catch {
        return .failure(error)
      }
    }
    try outcome.get()
    publishStatus()
    // Deliberately not started here: the caller installs the new Device Token first, so the loop
    // never runs with the previous Account's credential against the new Account's database.
  }

  /// One coalesced Diagnostic Event per failure class, table and cursor. Metadata only: an error
  /// code, a table, a cursor and the app version — never row contents, coordinates, the Device
  /// Token, the server body or an opaque database error.
  private func recordPermanentFailure(_ reason: SyncPauseReason, detail: String) {
    let key = "\(reason.slug):\(detail)"
    lock.lock()
    let isNew = recordedFailures.insert(key).inserted
    lock.unlock()
    guard isNew else { return }

    TelemetryRepository.shared.recordDiagnosticEvent(
      eventName: "sync_upload_paused",
      properties: [
        "operation": "sync",
        "phase": reason.slug,
        "message": "Sync upload paused",
        "sync_failure": reason.slug,
        "sync_detail": detail,
        "app_version": AppStatusCoordinator.installedMarketingVersion(),
      ]
    )
  }
}
