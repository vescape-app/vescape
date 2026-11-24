import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatFieldOverlay.kt `RefloatFieldRisk`
/// @parity /src/modules/board/lib/refloatFieldOverlay.ts `RefloatFieldRisk`
enum RefloatFieldRisk: String, Decodable, Equatable {
  case risky
  case `internal`
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatFieldOverlay.kt `RefloatFieldOverlayEntry`
struct RefloatFieldOverlayEntry: Equatable {
  let hardMin: Double?
  let hardMax: Double?
  let risk: RefloatFieldRisk?

  init(hardMin: Double? = nil, hardMax: Double? = nil, risk: RefloatFieldRisk? = nil) {
    self.hardMin = hardMin
    self.hardMax = hardMax
    self.risk = risk
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatFieldOverlay.kt
/// @parity /src/modules/board/lib/refloatFieldOverlay.ts
final class RefloatFieldOverlay {
  let entries: [String: RefloatFieldOverlayEntry]

  init(entries: [String: RefloatFieldOverlayEntry]) {
    self.entries = entries
  }

  func entry(_ fieldId: String) -> RefloatFieldOverlayEntry? {
    entries[fieldId]
  }

  func isInternal(_ fieldId: String) -> Bool {
    entries[fieldId]?.risk == .internal
  }

  static let empty = RefloatFieldOverlay(entries: [:])

  static let shared: RefloatFieldOverlay = {
    do {
      return try loadBundled()
    } catch {
      preconditionFailure("Failed to load bundled refloat-field-overlay.json: \(error)")
    }
  }()

  private struct RawCatalog: Decodable {
    struct RawRange: Decodable {
      let min: Double?
      let max: Double?
    }
    struct RawEntry: Decodable {
      let hardLimit: RawRange?
      let risk: RefloatFieldRisk?
    }
    let fields: [String: RawEntry]?
  }

  private enum OverlayError: Error {
    case missingResource
  }

  private static func loadBundled() throws -> RefloatFieldOverlay {
    #if SWIFT_PACKAGE
    let bundle = Bundle.module
    #else
    let module = Bundle(for: RefloatFieldOverlay.self)
    let bundle = module.url(forResource: "VescapeCoreAssets", withExtension: "bundle").flatMap(Bundle.init(url:)) ?? module
    #endif
    guard let url = bundle.url(forResource: "refloat-field-overlay", withExtension: "json") else {
      throw OverlayError.missingResource
    }
    return try parse(Data(contentsOf: url))
  }

  static func parse(_ data: Data) throws -> RefloatFieldOverlay {
    let raw = try JSONDecoder().decode(RawCatalog.self, from: data)
    guard let fields = raw.fields else { return .empty }
    var result: [String: RefloatFieldOverlayEntry] = [:]
    for (fieldId, entry) in fields {
      let hardMin = entry.hardLimit?.min.flatMap { $0.isFinite ? $0 : nil }
      let hardMax = entry.hardLimit?.max.flatMap { $0.isFinite ? $0 : nil }
      if hardMin != nil || hardMax != nil || entry.risk != nil {
        result[fieldId] = RefloatFieldOverlayEntry(
          hardMin: hardMin,
          hardMax: hardMax,
          risk: entry.risk
        )
      }
    }
    return RefloatFieldOverlay(entries: result)
  }
}
