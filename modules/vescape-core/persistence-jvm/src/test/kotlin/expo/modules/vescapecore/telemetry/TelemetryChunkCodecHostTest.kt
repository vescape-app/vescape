package expo.modules.vescapecore.telemetry

import java.io.File
import java.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Shared contract: `shared/telemetry-chunk-codec-contract.json`, peer `persistence-macos/TelemetryChunkCodecContract.swift`. */
class TelemetryChunkCodecHostTest {
  private val fixture = JSONObject(File("../shared/telemetry-chunk-codec-contract.json").readText())
  private val chains = fixture.getJSONArray("chains").objects().associateBy { it.getString("name") }

  @Test fun canonicalReconstructionHonoursMasks() {
    for ((name, chain) in chains) {
      val values = arrayOfNulls<Long>(TELEMETRY_CHUNK_VALUE_COLUMNS)
      val reconstructed = chain.getJSONArray("frames").objects().map { f ->
        reconstructTelemetryValues(values, f.getInt("flags"), f.getInt("changedMask1"), longs(f.getJSONArray("values")).toTypedArray())
        TelemetrySample(f.getLong("capturedAtMs"), f.getLong("elapsedRealtimeMs"), f.optIntOrNull("canId"), f.getInt("flags"), values.toList())
      }
      assertEquals(name, samples(chain), reconstructed)
    }
  }

  @Test fun encodeDecodeRoundTripsExactly() {
    for ((name, chain) in chains) assertEquals(name, samples(chain), TelemetryChunkCodec.decode(TelemetryChunkCodec.encode(samples(chain))))
    // Regenerate the Android golden blobs: VESCAPE_CHUNK_GOLDEN_OUT=<file> then paste into the fixture.
    System.getenv("VESCAPE_CHUNK_GOLDEN_OUT")?.let { path ->
      File(path).writeText(JSONArray(chains.map { (name, chain) ->
        JSONObject().put("chain", name).put("producer", "android")
          .put("base64", Base64.getEncoder().encodeToString(TelemetryChunkCodec.encode(samples(chain))))
      }).toString(1))
    }
  }

  @Test fun everyPlatformsGoldenBlobDecodesToItsChain() {
    val golden = fixture.getJSONArray("goldenBlobs").objects()
    assertEquals(setOf("android", "ios"), golden.map { it.getString("producer") }.toSet())
    for (blob in golden) {
      val chain = chains.getValue(blob.getString("chain"))
      assertEquals(blob.toString(), samples(chain), TelemetryChunkCodec.decode(Base64.getDecoder().decode(blob.getString("base64"))))
    }
  }

  @Test fun malformedBlobsAreRejected() {
    for (blob in fixture.getJSONArray("rejectedBlobs").objects()) {
      try {
        TelemetryChunkCodec.decode(Base64.getDecoder().decode(blob.getString("base64")))
        fail("accepted ${blob.getString("name")}")
      } catch (_: TelemetryChunkFormatException) {}
    }
  }

  @Test fun encoderRejectsValuesOutsideDeclaredWidth() {
    val values = MutableList<Long?>(TELEMETRY_CHUNK_VALUE_COLUMNS) { null }.apply { this[0] = Int.MAX_VALUE + 1L }
    val thrown = runCatching { TelemetryChunkCodec.encode(listOf(TelemetrySample(0, 0, null, 0, values))) }.exceptionOrNull()
    assertTrue(thrown is TelemetryChunkFormatException)
  }

  private fun samples(chain: JSONObject) = chain.getJSONArray("samples").objects().map { s ->
    TelemetrySample(s.getLong("capturedAtMs"), s.getLong("elapsedRealtimeMs"), s.optIntOrNull("canId"), s.getInt("flags"),
      longs(s.getJSONArray("values")))
  }

  private fun longs(array: JSONArray) = List(array.length()) { if (array.isNull(it)) null else array.getLong(it) }
  private fun JSONObject.optIntOrNull(key: String) = if (isNull(key)) null else getInt(key)
  private fun JSONArray.objects() = List(length()) { getJSONObject(it) }
}
