package expo.modules.vescapecore.config

// @parity /modules/vescape-core/ios/config/RefloatConfigDecoder.swift
internal class RefloatConfigDecodeException(message: String) : Exception(message)

internal object RefloatConfigDecoder {
  fun decodeFieldMap(schema: RefloatConfigSchema, rawConfig: ByteArray): Map<String, Any> =
    RefloatConfigFieldDecoder.decodeFieldMap(schema, rawConfig)

  fun decodeBoardConfigValues(
    schema: RefloatConfigSchema,
    configBytes: RefloatConfigBytes,
    boardId: String?,
    refloatBaseVersion: String?,
    capturedAt: Long,
    refloatVersion: String? = null,
  ): BoardConfigValues {
    val requiredLength = schema.fields.maxOfOrNull { it.offset + it.type.byteSize } ?: 0
    if (configBytes.config.size < requiredLength) {
      throw RefloatConfigDecodeException(
        "CONFIG_DECODE_FAILED: config length ${configBytes.config.size} < $requiredLength",
      )
    }
    return BoardConfigValues(
      boardId = boardId,
      refloatBaseVersion = refloatBaseVersion,
      capturedAtMs = capturedAt,
      freshness = BoardConfigFreshness.FRESH,
      values = decodeFieldMap(schema, configBytes.config),
      writeBase = BoardConfigWriteBase(
        schema = schema,
        rawConfig = configBytes.config,
        packageSignature = configBytes.packageSignature,
      ),
      refloatVersion = refloatVersion,
    )
  }
}
