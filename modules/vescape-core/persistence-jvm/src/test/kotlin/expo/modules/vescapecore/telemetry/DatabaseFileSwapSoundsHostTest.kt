package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.alerts.replaceSoundPackFiles
import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class DatabaseFileSwapSoundsHostTest {
  @Test fun soundInstallFailureAfterDatabaseCopyRestoresOriginalFiles() {
    val directory = Files.createTempDirectory("sound-restore-rollback").toFile()
    try {
      val installed = File(directory, "vescape.db").apply { writeText("old database") }
      val wal = File(directory, "vescape.db-wal").apply { writeText("old wal") }
      val incoming = File(directory, "incoming.db").apply { writeText("new database") }
      val sounds = File(directory, "custom-app-sounds").apply { mkdirs() }
      val oldPack = File(sounds, "packs.json").apply { writeText("old packs") }
      val staged = File(directory, "staged-sounds").apply { mkdirs() }
      File(staged, "packs.json").writeText("new packs")

      assertThrows(IllegalStateException::class.java) {
        replaceDatabaseFiles(incoming, installed) { candidate ->
          assertEquals("new database", candidate.readText())
          replaceSoundPackFiles(sounds, staged) { source, destination ->
            source.copyRecursively(destination)
            throw IllegalStateException("sound copy failed")
          }
        }
      }
      assertEquals("old database", installed.readText())
      assertEquals("old wal", wal.readText())
      assertEquals("old packs", oldPack.readText())
    } finally {
      directory.deleteRecursively()
    }
  }
}
