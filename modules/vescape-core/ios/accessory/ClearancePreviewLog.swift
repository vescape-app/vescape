import Foundation

/// Short-lived display history. Control still consumes every original reading.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/ClearancePreviewLog.kt
/// @parity /modules/vescape-core/src/index.ts `ClearancePreviewDiagnostics`
final class ClearancePreviewLog {
  private struct Sample { let at: Int64; let time: Int64; let seq: Int64; let value: Double? }
  private var samples: [Sample] = []
  private var emittedAt: Int64?
  private var chartAt: Int64?
  func reset() { samples.removeAll(); emittedAt = nil; chartAt = nil }
  func record(at: Int64, time: Int64, seq: Int64, value: Double?) {
    samples.append(Sample(at: at, time: time, seq: seq, value: value))
    samples.removeAll { $0.at < at - 20_000 }
    if samples.count > 601 { samples.removeFirst(samples.count - 601) }
  }
  func shouldEmit(at: Int64) -> Bool {
    if let emittedAt, at - emittedAt < 100 { return false }
    emittedAt = at
    return true
  }
  func snapshot(at: Int64) -> [String: Any?]? {
    if let chartAt, at - chartAt < 250 { return nil }
    chartAt = at
    var segments: [[Double]] = []
    var segment: [Double] = []
    var previous: Sample?
    var dropped: Int64 = 0
    for sample in samples {
      let gap = previous.map { sample.seq != $0.seq + 1 || sample.at - $0.at > 300 } ?? false
      if let previous { dropped += max(0, sample.seq - previous.seq - 1) }
      if gap || sample.value == nil {
        if !segment.isEmpty { segments.append(segment) }
        segment = []
      }
      if let value = sample.value { segment.append(Double(sample.time)); segment.append(value) }
      previous = sample
    }
    if !segment.isEmpty { segments.append(segment) }
    let span = (samples.last?.at ?? 0) - (samples.first?.at ?? 0)
    return [
      "segments": segments,
      "deliveredHz": span > 0 ? Double(samples.count - 1) * 1000 / Double(span) : 0,
      "dropped": dropped,
      "invalid": samples.filter { $0.value == nil }.count,
      "samples": samples.count,
    ]
  }
}
