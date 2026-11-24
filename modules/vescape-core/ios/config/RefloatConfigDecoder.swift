import Foundation

struct RefloatConfigDecodeException: Error {
  let message: String
  init(_ message: String) { self.message = message }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatConfigDecoder.kt
enum RefloatConfigDecoder {
  static func decodeFieldMap(schema: RefloatConfigSchema, rawConfig: [UInt8]) -> [String: Any] {
    RefloatConfigFieldDecoder.decodeFieldMap(schema: schema, rawConfig: rawConfig)
  }

  static func decodeBoardConfigValues(
    schema: RefloatConfigSchema,
    configBytes: RefloatConfigBytes,
    boardId: String?,
    refloatBaseVersion: String?,
    capturedAt: Int64,
    refloatVersion: String? = nil
  ) throws -> BoardConfigValues {
    let requiredLength = schema.fields.map { $0.offset + $0.type.byteSize }.max() ?? 0
    if configBytes.config.count < requiredLength {
      throw RefloatConfigDecodeException(
        "CONFIG_DECODE_FAILED: config length \(configBytes.config.count) < \(requiredLength)"
      )
    }
    return BoardConfigValues(
      boardId: boardId,
      refloatBaseVersion: refloatBaseVersion,
      capturedAtMs: capturedAt,
      freshness: .fresh,
      values: decodeFieldMap(schema: schema, rawConfig: configBytes.config),
      writeBase: BoardConfigWriteBase(
        schema: schema,
        rawConfig: configBytes.config,
        packageSignature: configBytes.packageSignature
      ),
      refloatVersion: refloatVersion
    )
  }
}
