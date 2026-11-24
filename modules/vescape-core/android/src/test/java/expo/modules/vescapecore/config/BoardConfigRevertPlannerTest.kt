package expo.modules.vescapecore.config

import java.io.File
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BoardConfigRevertPlannerTest {
  private fun repoRoot(): File {
    var dir: File? = File(System.getProperty("user.dir")!!).absoluteFile
    while (dir != null && !File(dir, "shared/fixtures/refloat-schema").isDirectory) dir = dir.parentFile
    return requireNotNull(dir) { "shared/fixtures/refloat-schema not found above ${System.getProperty("user.dir")}" }
  }

  private fun parseFixture(version: String): RefloatConfigSchema {
    val file = File(repoRoot(), "shared/fixtures/refloat-schema/settings-$version.xml.zlib")
    require(file.isFile) { "missing fixture $version" }
    return RefloatConfigSchemaParser.parse(file.readBytes())
  }

  private fun buildDefaultConfigBytes(
    schema: RefloatConfigSchema,
    overlay: RefloatFieldOverlay = RefloatFieldOverlay.empty,
  ): ByteArray {
    val totalSize = schema.fields.maxOfOrNull { it.offset + it.type.byteSize } ?: 0
    val raw = ByteArray(totalSize)
    for (field in schema.fields) {
      val defaultValue = field.defaultValue ?: continue
      val encoded = try {
        RefloatConfigEncoder.encodeFieldBytes(field, defaultValue, overlay)
      } catch (_: RefloatConfigEncodeException) {
        continue
      }
      encoded.copyInto(raw, destinationOffset = field.offset)
    }
    return raw
  }

  @Test
  fun sameSchemaRevertRestoresExactBytesExceptInternalFields() {
    val schema = parseFixture("1.3.0")
    val targetRaw = buildDefaultConfigBytes(schema)

    val editableChanges = mapOf<String, Any>(
      "kp" to 32.0,
      "atr_strength_up" to 2.2,
      "turntilt_strength" to 3.5,
      "leds.on" to false,
    )
    val currentRaw = RefloatConfigEncoder.encode(schema, targetRaw, editableChanges)

    val internalField = schema.fields.first { it.id.startsWith("meta.") }
    val internalBytesInCurrent = currentRaw.copyOfRange(
      internalField.offset,
      internalField.offset + internalField.type.byteSize,
    )
    currentRaw[internalField.offset] = (currentRaw[internalField.offset].toInt() xor 0x01).toByte()
    val mutatedInternalBytes = currentRaw.copyOfRange(
      internalField.offset,
      internalField.offset + internalField.type.byteSize,
    )
    assertFalse(internalBytesInCurrent.contentEquals(mutatedInternalBytes))

    val plan = BoardConfigRevertPlanner.plan(
      boardId = "board-1",
      currentSchema = schema,
      currentRawConfig = currentRaw,
      targetRevisionId = 42L,
      targetCreatedAtMs = 1_700_000_000_000L,
      targetRefloatVersion = "1.3.0",
      targetSchema = schema,
      targetRawConfig = targetRaw,
    )

    assertTrue(plan.sameSchema)
    assertEquals(42L, plan.targetRevisionId)
    assertTrue(plan.skippedFields.isEmpty())
    assertEquals(editableChanges.keys, plan.changes.keys)
    assertFalse(plan.changes.containsKey(internalField.id))

    val applied = RefloatConfigEncoder.encodeChangeset(schema, currentRaw, plan.changes).rawConfig
    for (field in schema.fields) {
      if (field.id == internalField.id) {
        val after = applied.copyOfRange(field.offset, field.offset + field.type.byteSize)
        assertArrayEquals("Internal field must not change on revert", mutatedInternalBytes, after)
      } else {
        val expected = targetRaw.copyOfRange(field.offset, field.offset + field.type.byteSize)
        val actual = applied.copyOfRange(field.offset, field.offset + field.type.byteSize)
        assertArrayEquals("Field ${field.id} must match target revision bytes", expected, actual)
      }
    }
  }

  @Test
  fun crossSchemaRevertRestoresMatchingIdsAndSkipsUnrestorableFields() {
    val schema121 = parseFixture("1.2.1")
    val schema130 = parseFixture("1.3.0")

    val targetRaw121 = RefloatConfigEncoder.encode(
      schema121,
      buildDefaultConfigBytes(schema121),
      mapOf("kp" to 28.0, "atr_strength_up" to 1.8),
    )
    val currentRaw130 = RefloatConfigEncoder.encode(
      schema130,
      buildDefaultConfigBytes(schema130),
      mapOf("kp" to 22.0, "atr_strength_up" to 0.9),
    )

    val plan = BoardConfigRevertPlanner.plan(
      boardId = "board-1",
      currentSchema = schema130,
      currentRawConfig = currentRaw130,
      targetRevisionId = 7L,
      targetCreatedAtMs = 1_700_000_000_000L,
      targetRefloatVersion = "1.2.1",
      targetSchema = schema121,
      targetRawConfig = targetRaw121,
    )

    assertFalse(plan.sameSchema)
    assertEquals(28.0, plan.changes["kp"] as Double, 1e-6)
    assertEquals(1.8, plan.changes["atr_strength_up"] as Double, 1e-6)

    val ids130 = schema130.fields.map { it.id }.toSet()
    val removedNonInternal121 = schema121.fields
      .filter { it.id !in ids130 && !it.id.startsWith("meta.") && !RefloatFieldOverlay.shared.isInternal(it.id) }
      .map { it.id }
    assertTrue("Expected some 1.2.1 fields absent in 1.3.0", removedNonInternal121.isNotEmpty())

    val skippedById = plan.skippedFields.associateBy { it.fieldId }
    for (missingId in removedNonInternal121) {
      assertTrue("Expected $missingId to be skipped", missingId in skippedById)
      assertEquals("Not in current firmware schema", skippedById[missingId]?.reason)
    }

    val applied = RefloatConfigEncoder.encodeChangeset(schema130, currentRaw130, plan.changes).rawConfig
    val decodedAfter = RefloatConfigFieldDecoder.decodeFieldMap(schema130, applied)
    assertEquals(28.0, decodedAfter["kp"] as Double, 1e-6)
    assertEquals(1.8, decodedAfter["atr_strength_up"] as Double, 1e-6)
  }

  @Test
  fun excludesInternalFieldsAndSkipsValuesFailingCurrentValidation() {
    val targetSchema = RefloatConfigSchema(
      hash = "target-hash",
      fields = listOf(
        RefloatConfigSchemaField("kp", RefloatConfigValueType.FLOAT32, "Angle P", null, 0.0, 100.0, 0),
        RefloatConfigSchemaField("limit_field", RefloatConfigValueType.UINT8, "Limit", null, 0.0, 200.0, 4),
        RefloatConfigSchemaField("meta.is_default", RefloatConfigValueType.BOOL, "Is Default", null, null, null, 5),
        RefloatConfigSchemaField("group_internal", RefloatConfigValueType.UINT8, "Internal", null, 0.0, 255.0, 6),
        RefloatConfigSchemaField("overlay_internal", RefloatConfigValueType.UINT8, "Overlay Internal", null, 0.0, 255.0, 7),
      ),
      groups = listOf(
        RefloatConfigSchemaGroup(
          name = "Internal",
          subgroups = listOf(
            RefloatConfigSchemaSubgroup(
              name = "Flags",
              items = listOf(RefloatConfigSchemaGroupItem.Field("group_internal")),
            ),
          ),
        ),
      ),
    )
    val currentSchema = RefloatConfigSchema(
      hash = "current-hash",
      fields = listOf(
        RefloatConfigSchemaField("kp", RefloatConfigValueType.FLOAT32, "Angle P", null, 0.0, 100.0, 0),
        RefloatConfigSchemaField("limit_field", RefloatConfigValueType.UINT8, "Limit", null, 0.0, 50.0, 4),
        RefloatConfigSchemaField("meta.is_default", RefloatConfigValueType.BOOL, "Is Default", null, null, null, 5),
        RefloatConfigSchemaField("group_internal", RefloatConfigValueType.UINT8, "Internal", null, 0.0, 255.0, 6),
        RefloatConfigSchemaField("overlay_internal", RefloatConfigValueType.UINT8, "Overlay Internal", null, 0.0, 255.0, 7),
      ),
      groups = targetSchema.groups,
    )
    val overlay = RefloatFieldOverlay(
      mapOf(
        "overlay_internal" to RefloatFieldOverlayEntry(risk = RefloatFieldRisk.INTERNAL),
      ),
    )

    val targetRaw = RefloatConfigEncoder.encode(
      targetSchema,
      ByteArray(8),
      mapOf("kp" to 25.0, "limit_field" to 120.0, "group_internal" to 9.0),
      RefloatFieldOverlay.empty,
    )
    targetRaw[5] = 1
    targetRaw[7] = 77

    val currentRaw = RefloatConfigEncoder.encode(
      currentSchema,
      ByteArray(8),
      mapOf("kp" to 20.0, "limit_field" to 30.0, "group_internal" to 1.0),
      RefloatFieldOverlay.empty,
    )
    currentRaw[5] = 0
    currentRaw[7] = 11

    val plan = BoardConfigRevertPlanner.plan(
      boardId = "board-1",
      currentSchema = currentSchema,
      currentRawConfig = currentRaw,
      targetRevisionId = 3L,
      targetCreatedAtMs = 1_000L,
      targetRefloatVersion = "1.2.1",
      targetSchema = targetSchema,
      targetRawConfig = targetRaw,
      overlay = overlay,
    )

    assertEquals(setOf("kp"), plan.changes.keys)
    assertEquals(25.0, plan.changes["kp"] as Double, 1e-6)
    assertEquals(listOf("limit_field"), plan.skippedFields.map { it.fieldId })
    assertFalse(plan.changes.containsKey("meta.is_default"))
    assertFalse(plan.changes.containsKey("group_internal"))
    assertFalse(plan.changes.containsKey("overlay_internal"))
  }
}
