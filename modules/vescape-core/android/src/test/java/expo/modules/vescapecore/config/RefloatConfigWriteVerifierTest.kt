package expo.modules.vescapecore.config

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RefloatConfigWriteVerifierTest {
  private val plain = RefloatConfigSchema("plain", emptyList())
  private val withMeta = RefloatConfigSchema(
    "meta",
    listOf(RefloatConfigSchemaField("meta.is_default", RefloatConfigValueType.INT8, "Config is Default", null, null, null, 2)),
  )

  @Test
  fun acceptsByteIdenticalConfig() {
    val result = RefloatConfigWriteVerifier.verify(plain, byteArrayOf(1, 2, 3), byteArrayOf(1, 2, 3))

    assertTrue(result is RefloatConfigWriteVerification.Success)
  }

  @Test
  fun rejectsSameLengthConfigWithHiddenByteMismatch() {
    val result = RefloatConfigWriteVerifier.verify(plain, byteArrayOf(1, 2, 3, 4), byteArrayOf(1, 2, 99, 4))

    assertEquals(
      RefloatConfigWriteVerification.Failure("Verification failed: first byte mismatch at offset 2"),
      result,
    )
  }

  @Test
  fun rejectsDifferentLengthConfig() {
    val result = RefloatConfigWriteVerifier.verify(plain, byteArrayOf(1, 2, 3), byteArrayOf(1, 2, 3, 4))

    assertEquals(
      RefloatConfigWriteVerification.Failure("Verification failed: expected 3 bytes, read back 4 bytes"),
      result,
    )
  }

  @Test
  fun expectsBoardToClearMetaIsDefault() {
    val written = byteArrayOf(1, 2, 1, 4)

    assertTrue(RefloatConfigWriteVerifier.verify(withMeta, written, byteArrayOf(1, 2, 0, 4)) is RefloatConfigWriteVerification.Success)
    assertEquals(
      RefloatConfigWriteVerification.Failure("Verification failed: first byte mismatch at offset 2"),
      RefloatConfigWriteVerifier.verify(withMeta, written, written),
    )
  }

  @Test
  fun disabledStaysStrictlyVerified() {
    val withDisabled = RefloatConfigSchema(
      "disabled",
      listOf(
        RefloatConfigSchemaField("disabled", RefloatConfigValueType.BOOL, "Disabled", null, null, null, 0),
        RefloatConfigSchemaField("meta.is_default", RefloatConfigValueType.BOOL, "Default", null, null, null, 1),
      ),
    )
    val written = byteArrayOf(1, 1)
    assertTrue(RefloatConfigWriteVerifier.verify(withDisabled, written, byteArrayOf(1, 0)) is RefloatConfigWriteVerification.Success)
    assertEquals(
      RefloatConfigWriteVerification.Failure("Verification failed: first byte mismatch at offset 0"),
      RefloatConfigWriteVerifier.verify(withDisabled, written, byteArrayOf(0, 0)),
    )
  }
}
