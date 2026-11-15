import Foundation

/// Native-owned monthly uploads. Failed months remain eligible on the next lifecycle trigger.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/riderprofiles/RiderStatsSender.kt
actor RiderStatsSender {
  static let shared = RiderStatsSender()
  private let defaults = UserDefaults.standard
  private var backfilledAccount: String?
  private var running = false
  private var pendingHistory = false
  private var pendingForeground = false
  private var pending = false
  private var removeCredentialListener: (() -> Void)?
  /// @parity /modules/vescape-core/src/index.ts `RiderStats`
  private static let fields = ["distanceM", "rideCount", "rideTimeMs", "topSpeedKmh", "avgSpeedKmh", "longestRideM", "batteryUsedWh", "batteryRegenWh"]

  func foreground() async {
    if removeCredentialListener == nil {
      removeCredentialListener = DeviceCredentialStore.shared.addChangeListener {
        Task { await RiderStatsSender.shared.trigger(history: true, foreground: false) }
      }
    }
    await trigger(history: false, foreground: true)
  }

  // History owns ride boundaries, including rides that began in an earlier Board Session/month.
  func recordingEnded() async { await trigger(history: true, foreground: false) }

  private func trigger(history: Bool, foreground: Bool) async {
    pending = true
    pendingHistory = pendingHistory || history
    pendingForeground = pendingForeground || foreground
    guard !running else { return }
    running = true
    defer { running = false }
    while pending {
      let history = pendingHistory
      let foreground = pendingForeground
      pending = false
      pendingHistory = false
      pendingForeground = false
      do { try await send(history: history, foreground: foreground) }
      catch { UnexpectedNativeError.report(operation: "rider_stats_send", category: "monthly_stats", error: error) }
    }
  }

  private func send(history: Bool, foreground: Bool) async throws {
    if history { backfilledAccount = nil }
    let store = DeviceCredentialStore.shared
    guard let credential = try store.read() else { backfilledAccount = nil; return }
    let origin = AppStatusCoordinator.serverBaseUrl
    guard credential.serverUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")) == origin,
          await onlineAllowed() else { return }
    let account = "\(origin)/\(credential.accountId)"
    let backfill = backfilledAccount != account
    let now = Date().timeIntervalSince1970
    let foregroundKey = "rider_stats_foreground:\(account)"
    let last = defaults.double(forKey: foregroundKey)
    if foreground && !history && now >= last && now - last < 3600 { return }
    if foreground { defaults.set(now, forKey: foregroundKey) }
    backfilledAccount = nil
    let calendar = Calendar.current
    let current = calendar.dateComponents([.year, .month], from: Date())
    let previous = calendar.dateComponents([.year, .month], from: calendar.date(byAdding: .month, value: -1, to: Date())!)
    var months = Set([monthKey(year: current.year!, month: current.month!), monthKey(year: previous.year!, month: previous.month!)])
    if history || backfill {
      let snapshot = try ProfileStatsRepository.shared.getProfileStatsSnapshot([:])
      guard let available = snapshot["months"] as? [[String: Int]] else { return }
      for month in available { months.insert(monthKey(year: month["year"]!, month: month["month"]!)) }
    }
    // Pin this run to its credential so an account change cannot upload A's payload as B.
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
      let payload = Dictionary(uniqueKeysWithValues: Self.fields.map { ($0, (stats[$0] ?? nil) ?? NSNull()) })
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
    if complete { backfilledAccount = account }
  }

  private func onlineAllowed() async -> Bool {
    await MainActor.run { !AppStatusCoordinator.shared.onlineBlocked }
  }

  private func monthKey(year: Int, month: Int) -> String { String(format: "%04d-%02d", year, month) }
}
