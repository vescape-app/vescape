import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/TransportDetection.kt
internal enum TransportDetection {
  struct Probe: Equatable {
    let transport: BoardTransport
    let confirmed: Bool
    let hasBms: Bool
    let vescFirmwareVersion: String?
    let refloatVersion: String?
    let refloatBaseVersion: String?

    init(
      transport: BoardTransport,
      confirmed: Bool,
      hasBms: Bool = false,
      vescFirmwareVersion: String? = nil,
      refloatVersion: String? = nil,
      refloatBaseVersion: String? = nil
    ) {
      self.transport = transport
      self.confirmed = confirmed
      self.hasBms = hasBms
      self.vescFirmwareVersion = vescFirmwareVersion
      self.refloatVersion = refloatVersion
      self.refloatBaseVersion = refloatBaseVersion
    }
  }

  struct Candidate: Equatable {
    let transport: BoardTransport
    let hasBms: Bool
    let vescFirmwareVersion: String?
    let refloatVersion: String?
    let refloatBaseVersion: String?

    init(
      transport: BoardTransport,
      hasBms: Bool,
      vescFirmwareVersion: String? = nil,
      refloatVersion: String? = nil,
      refloatBaseVersion: String? = nil
    ) {
      self.transport = transport
      self.hasBms = hasBms
      self.vescFirmwareVersion = vescFirmwareVersion
      self.refloatVersion = refloatVersion
      self.refloatBaseVersion = refloatBaseVersion
    }
  }

  enum Outcome: Equatable {
    case resolved(BoardTransport)
    case needsPick([BoardTransport])
    case none
  }

  struct Result: Equatable {
    let candidates: [Candidate]
    let outcome: Outcome

    var resolvedTransport: BoardTransport? {
      switch outcome {
      case .resolved(let transport): return transport
      case .needsPick, .none: return nil
      }
    }
  }

  static func candidatesToProbe(_ canPingResponders: [Int]) -> [BoardTransport] {
    var transports: [BoardTransport] = [.direct]
    for canId in Set(canPingResponders).sorted() { transports.append(.can(canId)) }
    return transports
  }

  static func resolve(_ probes: [Probe]) -> Result {
    let candidates = probes
      .filter { $0.confirmed }
      .map {
        Candidate(
          transport: $0.transport,
          hasBms: $0.hasBms,
          vescFirmwareVersion: $0.vescFirmwareVersion,
          refloatVersion: $0.refloatVersion,
          refloatBaseVersion: $0.refloatBaseVersion
        )
      }
    let transports = candidates.map { $0.transport }
    let outcome: Outcome
    switch transports.count {
    case 0: outcome = .none
    case 1: outcome = .resolved(transports[0])
    default: outcome = .needsPick(transports)
    }
    return Result(candidates: candidates, outcome: outcome)
  }
}
