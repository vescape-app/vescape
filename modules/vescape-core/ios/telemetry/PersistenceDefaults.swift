import Foundation

internal let alertBeepCountDefault = 3
internal func telemetryNowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000.0) }
