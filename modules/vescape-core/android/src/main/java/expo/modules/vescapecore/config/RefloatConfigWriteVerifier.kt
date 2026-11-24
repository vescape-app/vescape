package expo.modules.vescapecore.config

internal sealed class RefloatConfigWriteVerification {
  object Success : RefloatConfigWriteVerification()
  data class Failure(val message: String) : RefloatConfigWriteVerification()
}

// @parity /modules/vescape-core/ios/config/RefloatConfigWriteVerifier.swift
internal object RefloatConfigWriteVerifier {
  private const val META_IS_DEFAULT = "meta.is_default"

  fun verify(schema: RefloatConfigSchema, written: ByteArray, readBack: ByteArray): RefloatConfigWriteVerification {
    val expected = try {
      expectedReadBack(schema, written)
    } catch (e: RefloatConfigEncodeException) {
      return RefloatConfigWriteVerification.Failure("Verification failed: ${e.message}")
    }
    if (expected.contentEquals(readBack)) return RefloatConfigWriteVerification.Success

    if (expected.size != readBack.size) {
      return RefloatConfigWriteVerification.Failure(
        "Verification failed: expected ${expected.size} bytes, read back ${readBack.size} bytes",
      )
    }

    val firstMismatch = expected.indices.first { expected[it] != readBack[it] }
    return RefloatConfigWriteVerification.Failure(
      "Verification failed: first byte mismatch at offset $firstMismatch",
    )
  }

  private fun expectedReadBack(schema: RefloatConfigSchema, written: ByteArray): ByteArray =
    if (schema.fields.any { it.id == META_IS_DEFAULT }) {
      RefloatConfigEncoder.encode(
        schema,
        written,
        mapOf(META_IS_DEFAULT to 0),
        overlay = RefloatFieldOverlay.empty,
        allowInternal = true,
      )
    } else written
}
