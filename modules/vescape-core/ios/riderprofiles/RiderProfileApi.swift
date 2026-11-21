import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/riderprofiles/RiderProfileApi.kt `RiderProfileApiException`
/// @parity /modules/vescape-core/src/index.ts `RiderProfileErrorCode`
struct RiderProfileApiError: Error {
  let code: String
  let message: String

  static let signInRequired = "RIDER_PROFILE_SIGN_IN_REQUIRED"
  static let nickTaken = "RIDER_PROFILE_NICK_TAKEN"
  static let refused = "RIDER_PROFILE_REFUSED"
  static let unreachable = "RIDER_PROFILE_UNREACHABLE"
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/riderprofiles/RiderProfileApi.kt
/// @parity /modules/vescape-core/src/index.ts `RiderProfile`
final class RiderProfileApi {
  static let shared = RiderProfileApi(api: VescapeApi.forOrigin(AppStatusCoordinator.serverBaseUrl))

  private static let path = "/api/rider-profile"
  private static let ridersPath = "/api/riders"
  private static let friendsPath = "/api/friends"
  private static let rodeWithPath = "/api/rides/rode-with"
  private static let nickTakenSlug = "nick-taken"

  private let api: VescapeApi

  init(api: VescapeApi) {
    self.api = api
  }

  func mine() async throws -> [String: Any?]? {
    try unwrap(
      await api.request(.get, path: Self.path, auth: .required) { body in
        let json = try Self.object(body)
        guard let profile = json["profile"] as? [String: Any] else { return nil }
        return try Self.profile(profile)
      }
    )
  }

  func save(nick: String, nationality: String?) async throws -> [String: Any?] {
    try unwrap(
      await api.request(
        .put,
        path: Self.path,
        body: ["nick": nick, "nationality": nationality ?? NSNull()],
        auth: .required
      ) { try Self.profile(try Self.object($0)) }
    )
  }

  func search(nick prefix: String) async throws -> [[String: Any?]] {
    try unwrap(
      await api.request(.get, path: Self.ridersPath, query: ["nick": prefix], auth: .required) { body in
        guard let items = try Self.object(body)["items"] as? [[String: Any]] else {
          throw RiderProfileApiError(code: RiderProfileApiError.refused, message: "Unreadable rider search")
        }
        return try items.map(Self.profile)
      }
    )
  }

  func rider(_ accountId: String) async throws -> [String: Any?]? {
    let result = await api.request(.get, path: "\(Self.ridersPath)/\(accountId)", auth: .required) {
      try Self.detail(try Self.object($0))
    }
    if case .notFound = result { return nil }
    return try unwrap(result)
  }

  /// @parity /modules/vescape-core/src/index.ts `Friends`
  func friends() async throws -> [String: Any?] {
    try unwrap(
      await api.request(.get, path: Self.friendsPath, auth: .required) { body in
        let json = try Self.object(body)
        guard let friends = json["friends"] as? [[String: Any]],
              let incoming = json["incoming"] as? [[String: Any]],
              let outgoing = json["outgoing"] as? [[String: Any]]
        else { throw RiderProfileApiError(code: RiderProfileApiError.refused, message: "Unreadable friends") }
        return [
          "friends": try friends.map { friend -> [String: Any?] in
            var row = try Self.profile(friend)
            row["ridingNow"] = friend["ridingNow"] as? Bool ?? false
            row["lastOnlineAt"] = .some(friend["lastOnlineAt"] as? String)
            return row
          },
          "incoming": try incoming.map(Self.request),
          "outgoing": try outgoing.map(Self.request),
        ]
      }
    )
  }

  func requestFriend(_ accountId: String) async throws -> String {
    try unwrap(
      await api.request(.post, path: "\(Self.friendsPath)/requests", body: ["accountId": accountId], auth: .required) {
        guard let status = try Self.object($0)["status"] as? String else {
          throw RiderProfileApiError(code: RiderProfileApiError.refused, message: "Unreadable friend request")
        }
        return status
      }
    )
  }

  func acceptFriend(_ accountId: String) async throws {
    try unwrap(await api.request(.post, path: "\(Self.friendsPath)/requests/\(accountId)/accept", auth: .required) { _ in () })
  }

  func deleteFriendRequest(_ accountId: String) async throws {
    try unwrap(await api.request(.delete, path: "\(Self.friendsPath)/requests/\(accountId)", auth: .required) { _ in () })
  }

  func removeFriend(_ accountId: String) async throws {
    try unwrap(await api.request(.delete, path: "\(Self.friendsPath)/\(accountId)", auth: .required) { _ in () })
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/riderprofiles/RiderProfileApi.kt `rodeWith`
  /// @parity /modules/vescape-core/src/index.ts `RodeWithCrewRide`
  func rodeWith(from: String, to: String) async throws -> [[String: Any?]] {
    try unwrap(
      await api.request(.get, path: Self.rodeWithPath, query: ["from": from, "to": to], auth: .required) { body in
        guard let crewRides = try Self.object(body)["crewRides"] as? [[String: Any]] else {
          throw RiderProfileApiError(code: RiderProfileApiError.refused, message: "Unreadable rode-with")
        }
        return try crewRides.map { crewRide -> [String: Any?] in
          guard let startedAt = crewRide["startedAt"] as? String,
                let endedAt = crewRide["endedAt"] as? String,
                let riders = crewRide["riders"] as? [[String: Any]]
          else { throw RiderProfileApiError(code: RiderProfileApiError.refused, message: "Unreadable Crew Ride") }
          return ["startedAt": startedAt, "endedAt": endedAt, "riders": try riders.map(Self.rodeWithRider)]
        }
      }
    )
  }

  private static func rodeWithRider(_ json: [String: Any]) throws -> [String: Any?] {
    guard let startedAt = json["startedAt"] as? String,
          let endedAt = json["endedAt"] as? String,
          let track = json["track"] as? [[String: Any]]
    else { throw RiderProfileApiError(code: RiderProfileApiError.refused, message: "Unreadable Crew Ride rider") }
    var row = try profile(json)
    row["startedAt"] = startedAt
    row["endedAt"] = endedAt
    row["track"] = try Self.track(track)
    return row
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/riderprofiles/RiderProfileApi.kt `friendRides`
  /// @parity /modules/vescape-core/src/index.ts `FriendRidesPage`
  func friendRides(_ accountId: String, limit: Int? = nil, before: String? = nil) async throws -> [String: Any] {
    var query: [String: String] = [:]
    if let limit { query["limit"] = String(limit) }
    query["before"] = before
    return try unwrap(
      await api.request(.get, path: "\(Self.friendsPath)/\(accountId)/rides", query: query, auth: .required) { body in
        let json = try Self.object(body)
        guard let rides = json["rides"] as? [[String: Any]] else {
          throw RiderProfileApiError(code: RiderProfileApiError.refused, message: "Unreadable rides")
        }
        let rows = try rides.map { ride -> [String: Any?] in
          guard let startedAt = ride["startedAt"] as? String, let endedAt = ride["endedAt"] as? String
          else { throw RiderProfileApiError(code: RiderProfileApiError.refused, message: "Unreadable ride") }
          return ["startedAt": startedAt, "endedAt": endedAt]
        }
        let nextBefore: Any = (json["nextBefore"] as? String).map { $0 as Any } ?? NSNull()
        return ["rides": rows, "nextBefore": nextBefore]
      }
    )
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/riderprofiles/RiderProfileApi.kt `friendRideTrack`
  func friendRideTrack(_ accountId: String, from: String, to: String) async throws -> [[String: Any?]] {
    try unwrap(
      await api.request(
        .get, path: "\(Self.friendsPath)/\(accountId)/rides/track", query: ["from": from, "to": to], auth: .required
      ) { body in
        guard let track = try Self.object(body)["track"] as? [[String: Any]] else {
          throw RiderProfileApiError(code: RiderProfileApiError.refused, message: "Unreadable track")
        }
        return try Self.track(track)
      }
    )
  }

  private static func track(_ points: [[String: Any]]) throws -> [[String: Any?]] {
    try points.map { point -> [String: Any?] in
      guard let at = (point["at"] as? NSNumber)?.doubleValue,
            let lat = (point["lat"] as? NSNumber)?.doubleValue,
            let lng = (point["lng"] as? NSNumber)?.doubleValue
      else { throw RiderProfileApiError(code: RiderProfileApiError.refused, message: "Unreadable track point") }
      return ["at": at, "lat": lat, "lng": lng]
    }
  }

  private static func request(_ json: [String: Any]) throws -> [String: Any?] {
    var row = try profile(json)
    row["requestedAt"] = .some(json["requestedAt"] as? String)
    return row
  }

  private static func object(_ body: String) throws -> [String: Any] {
    guard let data = body.data(using: .utf8),
          let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { throw RiderProfileApiError(code: RiderProfileApiError.refused, message: "Unreadable response") }
    return json
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/riderprofiles/RiderProfileApi.kt `detail`
  /// @parity /modules/vescape-core/src/index.ts `RiderDetail`
  private static func detail(_ json: [String: Any]) throws -> [String: Any?] {
    guard let stats = json["stats"] as? [String: Any],
          let months = stats["months"] as? [[String: Any]] else {
      throw RiderProfileApiError(code: RiderProfileApiError.refused, message: "Unreadable rider stats")
    }
    var row = try profile(json)
    let monthly = try months.map { month -> [String: Any?] in
      guard let key = month["month"] as? String else {
        throw RiderProfileApiError(code: RiderProfileApiError.refused, message: "Unreadable rider month")
      }
      var values = try Self.stats(month)
      values["month"] = key
      return values
    }
    row["stats"] = [
      "total": try (stats["total"] as? [String: Any]).map(Self.stats) ?? NSNull(),
      "months": monthly,
    ] as [String: Any]
    return row
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/riderprofiles/RiderProfileApi.kt `stats`
  /// @parity /modules/vescape-core/src/index.ts `RiderStats`
  /// @parity /modules/vescape-core/src/index.ts `RiderMonthStats`
  private static func stats(_ json: [String: Any]) throws -> [String: Any?] {
    var values: [String: Any?] = [:]
    let nullable: Set<String> = ["distanceM", "longestRideM", "batteryUsedWh", "batteryRegenWh"]
    for key in ["distanceM", "rideCount", "rideTimeMs", "topSpeedKmh", "avgSpeedKmh", "longestRideM", "batteryUsedWh", "batteryRegenWh"] {
      if nullable.contains(key), json[key] is NSNull { values[key] = .some(nil) }
      else if let value = json[key] as? NSNumber { values[key] = value }
      else { throw RiderProfileApiError(code: RiderProfileApiError.refused, message: "Unreadable rider stats") }
    }
    return values
  }

  private static func profile(_ json: [String: Any]) throws -> [String: Any?] {
    guard let accountId = json["accountId"] as? String, let nick = json["nick"] as? String
    else {
      throw RiderProfileApiError(code: RiderProfileApiError.refused, message: "Unreadable Rider Profile")
    }
    return ["accountId": accountId, "nick": nick, "nationality": json["nationality"] as? String]
  }

  private func unwrap<T>(_ result: ApiResult<T>) throws -> T {
    switch result {
    case .ok(let value): return value
    case .unauthorized:
      throw RiderProfileApiError(code: RiderProfileApiError.signInRequired, message: "Sign-in required")
    case .forbidden, .notFound:
      throw RiderProfileApiError(code: RiderProfileApiError.refused, message: "Rider Profile refused")
    case .invalid(let error):
      let code = error == Self.nickTakenSlug ? RiderProfileApiError.nickTaken : RiderProfileApiError.refused
      throw RiderProfileApiError(code: code, message: error)
    case .malformed(let cause):
      throw RiderProfileApiError(code: RiderProfileApiError.refused, message: cause)
    case .unavailable(let cause):
      throw RiderProfileApiError(code: RiderProfileApiError.unreachable, message: cause)
    case .cancelled:
      throw CancellationError()
    }
  }
}
