import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/riderprofiles/RiderStatsSender.kt
actor RiderStatsSender {
  static let shared = RiderStatsSender()
  private let defaults = UserDefaults.standard
  private let policy = RiderStatsUploadPolicy(defaults: .standard)
  private var running = false
  private var pending: [(foreground: Bool, recording: (String, Int64, Int64)?)] = []
  private var removeCredentialListener: (() -> Void)?
  /// @parity /modules/vescape-core/src/index.ts `RiderStats`
  static let fields = ["distanceM", "rideCount", "rideTimeMs", "topSpeedKmh", "avgSpeedKmh", "longestRideM", "batteryUsedWh", "batteryRegenWh"]

  func foreground() async {
    if removeCredentialListener == nil {
      do { policy.accountId = try DeviceCredentialStore.shared.read()?.accountId }
      catch {
        UnexpectedNativeError.report(operation: "rider_stats_credential_read", category: "monthly_stats", error: error)
        return
      }
      removeCredentialListener = DeviceCredentialStore.shared.addChangeListener {
        do {
          let accountId = try DeviceCredentialStore.shared.read()?.accountId
          Task { await RiderStatsSender.shared.credentialChanged(accountId) }
        } catch {
          UnexpectedNativeError.report(operation: "rider_stats_credential_read", category: "monthly_stats", error: error)
        }
      }
    }
    await trigger(foreground: true)
  }

  private func credentialChanged(_ accountId: String?) async {
    if policy.accountChanged(accountId) { await trigger(foreground: false) }
  }

  func recordingEnded(boardId: String, sinceMs: Int64, throughMs: Int64) async {
    await trigger(foreground: false, recording: (boardId, sinceMs, throughMs))
  }

  private func trigger(foreground: Bool, recording: (String, Int64, Int64)? = nil) async {
    pending.append((foreground, recording))
    guard !running else { return }
    running = true
    defer { running = false }
    while !pending.isEmpty {
      let request = pending.removeFirst()
      do { try await send(foreground: request.foreground, recording: request.recording) }
      catch { UnexpectedNativeError.report(operation: "rider_stats_send", category: "monthly_stats", error: error) }
    }
  }

  private func send(foreground: Bool, recording: (String, Int64, Int64)?) async throws {
    let store = DeviceCredentialStore.shared
    guard let credential = try store.read() else { return }
    let origin = AppStatusCoordinator.serverBaseUrl
    guard credential.serverUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")) == origin,
          await onlineAllowed() else { return }
    let account = "\(origin)/\(credential.accountId)"
    let backfill = policy.needsBackfill(account)
    guard policy.begin(account, foreground: foreground, now: Date().timeIntervalSince1970) else { return }
    let rideMonths = try recording.map { board, since, through in
      try ProfileStatsRepository.shared.getRecordingMonths(boardId: board, sinceMs: since, throughMs: through)
    } ?? []
    var available = Set<String>()
    if backfill {
      let snapshot = try ProfileStatsRepository.shared.getProfileStatsSnapshot([:])
      guard let months = snapshot["months"] as? [[String: Int]] else { return }
      for month in months { available.insert(String(format: "%04d-%02d", month["year"]!, month["month"]!)) }
    }
    let months = policy.months(now: Date(), foreground: foreground, rideMonths: rideMonths, backfill: backfill ? available : nil)
    let api = VescapeApi(
      baseUrl: origin,
      appVersion: AppStatusCoordinator.installedMarketingVersion(),
      credentialProvider: {
        guard let current = try store.read(), current.accountId == credential.accountId,
              current.token == credential.token else { return nil }
        return current
      },
      onUnauthorized: {
        if try store.read()?.token == credential.token { try store.reject() }
        Task { @MainActor in AppStatusCoordinator.shared.refresh() }
      }
    )
    var complete = true
    for month in months.sorted().reversed() {
      guard try store.read()?.token == credential.token, await onlineAllowed() else { return }
      let parts = month.split(separator: "-").compactMap { Int($0) }
      let snapshot = try ProfileStatsRepository.shared.getProfileStatsSnapshot(["year": parts[0], "month": parts[1]])
      guard let stats = snapshot["monthly"] as? [String: Any?] else { return }
      let payload = normalizedRiderStats(stats)
      let encoded = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
      let key = "rider_stats_payload:\(account)/\(month)"
      if defaults.data(forKey: key) == encoded { continue }
      let result = await api.request(.put, path: "/api/rider-stats/\(month)", body: payload, auth: .required) { _ in () }
      if case .ok = result, try store.read()?.token == credential.token {
        defaults.set(encoded, forKey: key)
      } else {
        complete = false
      }
    }
    if backfill { policy.finished(account, complete: complete) }
  }

  private func onlineAllowed() async -> Bool {
    await MainActor.run { !AppStatusCoordinator.shared.onlineBlocked }
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/riderprofiles/RiderStatsSender.kt `RiderStatsUploadPolicy`
final class RiderStatsUploadPolicy {
  private let defaults: UserDefaults
  var accountId: String?
  init(defaults: UserDefaults) { self.defaults = defaults }
  func accountChanged(_ next: String?) -> Bool {
    guard accountId != next else { return false }
    accountId = next
    return next != nil
  }
  func needsBackfill(_ account: String) -> Bool { !defaults.bool(forKey: "rider_stats_backfilled:\(account)") }
  func begin(_ account: String, foreground: Bool, now: Double) -> Bool {
    let key = "rider_stats_foreground:\(account)"
    let last = defaults.double(forKey: key)
    if foreground && !needsBackfill(account) && now >= last && now - last < 3600 { return false }
    if foreground { defaults.set(now, forKey: key) }
    return true
  }
  func months(now: Date, foreground: Bool, rideMonths: Set<String>, backfill: Set<String>?, calendar: Calendar = .current) -> Set<String> {
    if let backfill { return backfill }
    guard foreground else { return rideMonths }
    return Set([now, calendar.date(byAdding: .month, value: -1, to: now)!].map { date in
      let parts = calendar.dateComponents([.year, .month], from: date)
      return String(format: "%04d-%02d", parts.year!, parts.month!)
    })
  }
  func finished(_ account: String, complete: Bool) {
    if complete { defaults.set(true, forKey: "rider_stats_backfilled:\(account)") }
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/riderprofiles/RiderStatsSender.kt `normalizedRiderStats`
func normalizedRiderStats(_ stats: [String: Any?]) -> [String: Any] {
  Dictionary(uniqueKeysWithValues: RiderStatsSender.fields.map { field in
    let nullable = ["distanceM", "longestRideM", "batteryUsedWh", "batteryRegenWh"].contains(field)
    let number = (stats[field] as? NSNumber)?.doubleValue
    let maximum: Double
    switch field {
    case "rideCount": maximum = 100_000
    case "rideTimeMs": maximum = 2_678_400_000
    case "topSpeedKmh", "avgSpeedKmh": maximum = 1000
    default: maximum = 1e8
    }
    guard let number, number.isFinite else { return (field, nullable ? NSNull() : 0) }
    let bounded = min(maximum, max(0, number))
    return (field, field == "rideCount" || field == "rideTimeMs" ? bounded.rounded() : bounded)
  })
}
