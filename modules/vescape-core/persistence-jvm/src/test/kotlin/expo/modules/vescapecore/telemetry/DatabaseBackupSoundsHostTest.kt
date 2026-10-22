package expo.modules.vescapecore.telemetry

import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.file.Files
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class DatabaseBackupSoundsHostTest {
  @Test fun backupRoundTripPreservesLibraryAndLegacySoundsAndSkipsUnrelatedFiles() {
    val directory = Files.createTempDirectory("backup-sounds").toFile()
    try {
      val database = File(directory, "source.db").apply { writeText("database") }
      val sounds = File(directory, "sounds").apply { mkdirs() }
      val expected = mapOf(
        "my-sounds.json" to "library manifest",
        "packs.json" to "legacy manifest",
        "12345678-1234-1234-1234-123456789abc.wav" to "wav audio",
        "12345678-1234-1234-1234-123456789abc.m4a" to "m4a audio",
        "12345678-1234-1234-1234-123456789abc.mp3" to "mp3 audio",
      )
      expected.forEach { (name, contents) -> File(sounds, name).writeText(contents) }
      File(sounds, "unfinished.import").writeText("partial import")
      val archive = ByteArrayOutputStream()
      DatabaseBackupArchive.write(database, DatabaseBackupArchive.manifest("android", 1, "test", database.length(), 1), archive, sounds)

      val restored = File(directory, "restored.db")
      val restoredSounds = File(directory, "restored-sounds")
      DatabaseBackupArchive.extract(archive.toByteArray().inputStream(), restored, restoredSounds)
      assertEquals("database", restored.readText())
      assertEquals(expected, restoredSounds.listFiles()!!.associate { it.name to it.readText() })
    } finally {
      directory.deleteRecursively()
    }
  }

  @Test fun restoreRejectsSoundPathTraversal() {
    val directory = Files.createTempDirectory("backup-sound-path").toFile()
    try {
      val archive = ByteArrayOutputStream()
      ZipOutputStream(archive).use { zip ->
        zip.putNextEntry(ZipEntry("custom-app-sounds/../escaped.mp3"))
        zip.write(byteArrayOf(1))
        zip.closeEntry()
      }
      assertThrows(IllegalArgumentException::class.java) {
        DatabaseBackupArchive.extract(archive.toByteArray().inputStream(), File(directory, "restored.db"), File(directory, "sounds"))
      }
      assertFalse(File(directory, "escaped.mp3").exists())
    } finally {
      directory.deleteRecursively()
    }
  }
}
