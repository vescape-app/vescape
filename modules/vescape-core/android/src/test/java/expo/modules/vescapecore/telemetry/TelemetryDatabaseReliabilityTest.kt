package expo.modules.vescapecore.telemetry

import java.io.IOException
import java.nio.file.Files
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

/** @parity /modules/vescape-core/ios/telemetry/TelemetryDatabaseReliabilityTests.swift */
class TelemetryDatabaseReliabilityTest {
  @Test fun `failed legacy move preserves original file`() {
    val root = Files.createTempDirectory("vescape-legacy").toFile()
    val legacy = root.resolve("telemetry.db").apply { writeBytes("original".toByteArray()) }
    val target = root.resolve("missing/vescape.sqlite")

    assertThrows(IOException::class.java) { TelemetryDatabase.moveLegacyDatabaseFile(legacy, target) }
    assertArrayEquals("original".toByteArray(), legacy.readBytes())
    assertFalse(target.exists())
    root.deleteRecursively()
  }

  @Test fun `database size distinguishes missing file from metadata failure`() {
    val root = Files.createTempDirectory("vescape-size").toFile()
    assertEquals(0L, TelemetryDatabase.databaseSizeBytes(root.resolve("missing")))
    val existing = root.resolve("vescape.sqlite").apply { writeBytes(byteArrayOf(1)) }
    assertThrows(IOException::class.java) {
      TelemetryDatabase.databaseSizeBytes(existing) { throw IOException("metadata failed") }
    }
    root.deleteRecursively()
  }
}
