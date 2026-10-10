package expo.modules.vescapecore.telemetry

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import expo.modules.vescapecore.alerts.CustomAppSounds
import kotlin.io.path.createTempDirectory
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class DatabaseBackupArchiveSoundsTest {
  @Test fun malformedSoundManifestFailsBeforeDatabaseSwap() {
    val stage = createTempDirectory("bad-sound-manifest-").toFile()
    try {
      File(stage, "packs.json").writeText("not-json")
      assertThrows(Exception::class.java) { CustomAppSounds.validateBackup(stage) }
    } finally { stage.deleteRecursively() }
  }

  @Test fun customSoundsRoundTripWithDatabase() {
    val root = createTempDirectory("app-sounds-backup-").toFile()
    try {
      val database = File(root, "db.sqlite").apply { writeBytes(byteArrayOf(1, 2, 3)) }
      val source = File(root, "source").apply { mkdirs() }
      File(source, "packs.json").writeText("[]")
      val sound = ByteArray(16) { it.toByte() }
      File(source, "00000000-0000-0000-0000-000000000000.wav").writeBytes(sound)
      val output = ByteArrayOutputStream()
      DatabaseBackupArchive.write(database, DatabaseBackupArchive.manifest("android", 48, "test", 3, 1), output, source)
      val restored = File(root, "restored.sqlite")
      val sounds = File(root, "sounds")
      val manifest = DatabaseBackupArchive.extract(ByteArrayInputStream(output.toByteArray()), restored, sounds)
      assertEquals("vesc-db-backup", manifest.getString("format"))
      assertArrayEquals(database.readBytes(), restored.readBytes())
      assertArrayEquals(sound, File(sounds, "00000000-0000-0000-0000-000000000000.wav").readBytes())
    } finally { root.deleteRecursively() }
  }
}
