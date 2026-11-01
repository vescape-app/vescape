import Compression
import Foundation

/// Several rides as one `.zip`: one file per ride, no folders, written as a stream so memory stays
/// flat at any ride count. Names use device time: `2026-08-03_1726_<name>.<ext>`, `-2`, `-3` on clash.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideBatch.kt
/// @parity /modules/vescape-core/src/index.ts `RideSelection`
internal enum RideBatch {
  /// One ride window; `name` is the Board name for rides and the Favorite's name for Favorites.
  struct Item: Equatable {
    let fromMs: Int64
    let toMs: Int64
    let boardId: String?
    let name: String?

    init(fromMs: Int64, toMs: Int64, boardId: String?, name: String?) {
      self.fromMs = fromMs; self.toMs = toMs; self.boardId = boardId; self.name = name
    }

    init(_ map: [String: Any]) throws {
      guard let from = telemetryLong(map["fromMs"]), let to = telemetryLong(map["toMs"]), from <= to else {
        throw RideBatchError.invalid("Invalid ride range")
      }
      self.init(fromMs: from, toMs: to, boardId: map["boardId"] as? String, name: map["name"] as? String)
    }
  }

  enum RideBatchError: LocalizedError {
    case invalid(String)
    case cancelled
    var errorDescription: String? {
      switch self { case .invalid(let message): return message; case .cancelled: return "Ride export cancelled" }
    }
  }

  static func format(_ value: Any?) throws -> RideExport.Format {
    switch value as? String {
    case "gpx": return .gpx
    case "csv": return .csv
    case "floaty": return .floaty
    default: throw RideBatchError.invalid("Unknown export format")
    }
  }

  private static func formatter(_ pattern: String, _ zone: TimeZone) -> DateFormatter {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = zone
    formatter.dateFormat = pattern
    return formatter
  }

  private static func date(_ ms: Int64) -> Date { Date(timeIntervalSince1970: Double(ms) / 1000) }

  static func entryNames(_ items: [Item], fileExtension: String, zone: TimeZone) -> [String] {
    let stamp = formatter("yyyy-MM-dd_HHmm", zone)
    var used: [String: Int] = [:]
    return items.map { item in
      let base = "\(stamp.string(from: date(item.fromMs)))_\(slug(item.name))"
      let n = (used[base] ?? 0) + 1
      used[base] = n
      return n == 1 ? "\(base).\(fileExtension)" : "\(base)-\(n).\(fileExtension)"
    }
  }

  /// `vescape-rides-<day>.zip`, or `vescape-rides-<first>_<last>.zip` when the rides span days.
  static func zipName(_ items: [Item], zone: TimeZone) -> String {
    let day = formatter("yyyy-MM-dd", zone)
    let first = day.string(from: date(items.map(\.fromMs).min() ?? 0))
    let last = day.string(from: date(items.map(\.fromMs).max() ?? 0))
    return first == last ? "vescape-rides-\(first).zip" : "vescape-rides-\(first)_\(last).zip"
  }

  /// ASCII letters and digits; every other run becomes one `-`.
  static func slug(_ name: String?) -> String {
    var out = ""
    for scalar in (name ?? "").unicodeScalars {
      if scalar.isASCII, CharacterSet.alphanumerics.contains(scalar) { out.unicodeScalars.append(scalar) }
      else if !out.isEmpty, out.last != "-" { out.append("-") }
    }
    while out.last == "-" { out.removeLast() }
    return out.isEmpty ? "ride" : out
  }

  static func zip(directory: URL, items: [Item], format: RideExport.Format, zone: TimeZone,
    isCancelled: @escaping () -> Bool, onProgress: (_ done: Int, _ total: Int) -> Void,
    writeRide: (_ item: Item, _ write: (String) throws -> Void) throws -> Void) throws -> [String: Any] {
    guard !items.isEmpty else { throw RideBatchError.invalid("No rides to export") }
    // Own folder per export: the zip keeps its readable name in the share sheet without clashing.
    let folder = directory.appendingPathComponent("ride-export-\(UUID().uuidString)", isDirectory: true)
    let file = folder.appendingPathComponent(zipName(items, zone: zone))
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      guard FileManager.default.createFile(atPath: file.path, contents: nil) else {
        throw RideBatchError.invalid("Could not create export file")
      }
      let handle = try FileHandle(forWritingTo: file)
      defer { try? handle.close() } // intentional-suppression: close after success or failure; errors already surfaced by writes.
      let archive = ZipStreamWriter(handle: handle)
      for (index, name) in entryNames(items, fileExtension: format.fileExtension, zone: zone).enumerated() {
        if isCancelled() { throw RideBatchError.cancelled }
        try archive.entry(name) { write in
          try withoutActuallyEscaping(write) { write in
            try writeRide(items[index]) { text in
              if isCancelled() { throw RideBatchError.cancelled }
              try write(text)
            }
          }
        }
        onProgress(index + 1, items.count)
      }
      try archive.finish()
      return ["uri": file.absoluteString, "mimeType": "application/zip", "uti": "public.zip-archive"]
    } catch {
      // intentional-suppression: preserve the export failure; OS temporary storage can reclaim leftovers.
      try? FileManager.default.removeItem(at: folder)
      throw error
    }
  }
}

/// DEFLATE entries with trailing data descriptors, so no entry is ever held in memory. No Zip64:
/// one archive stays under 4 GB.
private final class ZipStreamWriter {
  private struct Record { let name: [UInt8]; let crc: UInt32; let compressed: UInt32; let size: UInt32; let offset: UInt32 }
  private let handle: FileHandle
  private var offset: UInt64 = 0
  private var records: [Record] = []
  private static let flags: UInt16 = 0x0808 // data descriptor + UTF-8 names

  init(handle: FileHandle) { self.handle = handle }

  private func emit(_ data: Data) throws {
    try handle.write(contentsOf: data)
    offset += UInt64(data.count)
  }

  func entry(_ name: String, body: (_ write: (String) throws -> Void) throws -> Void) throws {
    let nameBytes = Array(name.utf8)
    let start = UInt32(offset)
    var header = Data()
    header.append(le32: 0x0403_4b50); header.append(le16: 20); header.append(le16: Self.flags); header.append(le16: 8)
    header.append(le16: 0); header.append(le16: 0x21) // 1980-01-01, no clock in the archive
    header.append(le32: 0); header.append(le32: 0); header.append(le32: 0)
    header.append(le16: UInt16(nameBytes.count)); header.append(le16: 0)
    header.append(contentsOf: nameBytes)
    try emit(header)

    var crc: UInt32 = 0xFFFF_FFFF
    var size: UInt64 = 0
    let compressedStart = offset
    let filter = try OutputFilter(.compress, using: .zlib) { chunk in
      if let chunk { try self.emit(chunk) }
    }
    var buffer = Data()
    func drain() throws {
      crc = ZipArchive.crc32(update: crc, buffer)
      size += UInt64(buffer.count)
      try filter.write(buffer)
      buffer.removeAll(keepingCapacity: true)
    }
    try body { text in
      buffer.append(contentsOf: text.utf8)
      if buffer.count >= 64_000 { try drain() }
    }
    try drain()
    try filter.finalize()
    crc ^= 0xFFFF_FFFF
    let compressed = offset - compressedStart
    guard offset < UInt64(UInt32.max), size < UInt64(UInt32.max) else {
      throw RideBatch.RideBatchError.invalid("Export is larger than 4 GB")
    }
    var descriptor = Data()
    descriptor.append(le32: 0x0807_4b50); descriptor.append(le32: crc)
    descriptor.append(le32: UInt32(compressed)); descriptor.append(le32: UInt32(size))
    try emit(descriptor)
    records.append(Record(name: nameBytes, crc: crc, compressed: UInt32(compressed), size: UInt32(size), offset: start))
  }

  func finish() throws {
    guard records.count <= Int(UInt16.max) else { throw RideBatch.RideBatchError.invalid("Too many rides for one archive") }
    let centralStart = UInt32(offset)
    var central = Data()
    for record in records {
      central.append(le32: 0x0201_4b50); central.append(le16: 20); central.append(le16: 20)
      central.append(le16: Self.flags); central.append(le16: 8); central.append(le16: 0); central.append(le16: 0x21)
      central.append(le32: record.crc); central.append(le32: record.compressed); central.append(le32: record.size)
      central.append(le16: UInt16(record.name.count)); central.append(le16: 0); central.append(le16: 0)
      central.append(le16: 0); central.append(le16: 0); central.append(le32: 0); central.append(le32: record.offset)
      central.append(contentsOf: record.name)
    }
    var end = Data()
    end.append(le32: 0x0605_4b50); end.append(le16: 0); end.append(le16: 0)
    end.append(le16: UInt16(records.count)); end.append(le16: UInt16(records.count))
    end.append(le32: UInt32(central.count)); end.append(le32: centralStart); end.append(le16: 0)
    try emit(central)
    try emit(end)
  }
}
