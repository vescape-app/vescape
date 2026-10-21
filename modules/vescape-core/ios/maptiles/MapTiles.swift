import Foundation
import os

/// Raster map tiles of the hosted thumbnail style, rendered by the Mapbox Static Tiles API and kept on
/// disk with no expiry: a map behind a ride thumbnail does not need to track every change on the
/// ground, and every cache hit is one API request saved. The OS may still clear the Caches directory
/// under storage pressure; tiles then download again on demand.
///
/// Concurrent requests for one tile share a single download. A failed download stores nothing, so the
/// next request retries.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/maptiles/MapTiles.kt
actor MapTiles {
  /// `owner/styleId` of the hosted style (`bun run map:publish-thumbnail-style`). Part of the cache
  /// path, so a different style never reads another style's tiles.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/maptiles/MapTiles.kt `STYLE`
  static let style = "kacperkozak/cmux9d4th002j01s4fm7tc4mt"

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/maptiles/MapTiles.kt `MAX_ZOOM`
  static let maxZoom = 22

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/maptiles/MapTiles.kt `MAX_PARALLEL_DOWNLOADS`
  private static let maxParallelDownloads = 4
  private static let callTimeoutSeconds: TimeInterval = 15
  private static let baseUrl = "https://api.mapbox.com/styles/v1"
  private static let log = Logger(subsystem: "app.vescape.core", category: "MapTiles")

  static let shared: MapTiles = {
    let configuration = URLSessionConfiguration.default
    configuration.timeoutIntervalForRequest = callTimeoutSeconds
    configuration.httpMaximumConnectionsPerHost = maxParallelDownloads
    let session = URLSession(configuration: configuration)
    let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    return MapTiles(
      directory: caches.appendingPathComponent("map-tiles", isDirectory: true),
      fetch: { url in await fetchTile(session, url) },
      accessToken: MapboxDirectionsApi.bakedAccessToken
    )
  }()

  private let directory: URL
  private let fetch: @Sendable (URL) async -> Data?
  private let accessToken: String
  private var inFlight: [String: Task<URL?, Never>] = [:]

  init(directory: URL, fetch: @escaping @Sendable (URL) async -> Data?, accessToken: String) {
    self.directory = directory
    self.fetch = fetch
    self.accessToken = accessToken
  }

  /// The tile's cached JPEG, downloading it first if needed. Nil for an invalid tile or a failed download.
  func tile(z: Int, x: Int, y: Int) async -> URL? {
    guard (0...Self.maxZoom).contains(z), (0..<(1 << z)).contains(x), (0..<(1 << z)).contains(y) else {
      return nil
    }
    let file = directory.appendingPathComponent("\(Self.style)/\(z)/\(x)/\(y).jpg")
    if FileManager.default.fileExists(atPath: file.path) { return file }
    if let running = inFlight[file.path] { return await running.value }

    let download = Task { await self.download(to: file, z: z, x: x, y: y) }
    inFlight[file.path] = download
    let result = await download.value
    inFlight[file.path] = nil
    return result
  }

  private func download(to file: URL, z: Int, x: Int, y: Int) async -> URL? {
    guard !accessToken.isEmpty,
      var components = URLComponents(string: "\(Self.baseUrl)/\(Self.style)/tiles/512/\(z)/\(x)/\(y).jpeg")
    else { return nil }
    components.queryItems = [URLQueryItem(name: "access_token", value: accessToken)]
    guard let url = components.url, let data = await fetch(url) else { return nil }

    // Write beside the target, then move: a reader never sees half a tile.
    let partial = file.deletingLastPathComponent()
      .appendingPathComponent("\(file.lastPathComponent).\(UUID().uuidString).partial")
    // intentional-suppression: after a successful move the partial file is already gone.
    defer { try? FileManager.default.removeItem(at: partial) }
    do {
      try FileManager.default.createDirectory(
        at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
      try data.write(to: partial)
      try FileManager.default.moveItem(at: partial, to: file)
      return file
    } catch {
      Self.log.warning("Cannot store map tile: \(error.localizedDescription)")
      return nil
    }
  }

  private static func fetchTile(_ session: URLSession, _ url: URL) async -> Data? {
    do {
      let (data, response) = try await session.data(from: url)
      guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
        log.warning("Map tile request failed: HTTP \((response as? HTTPURLResponse)?.statusCode ?? -1)")
        return nil
      }
      return data
    } catch {
      log.warning("Map tile request failed: \(error.localizedDescription)")
      return nil
    }
  }
}
