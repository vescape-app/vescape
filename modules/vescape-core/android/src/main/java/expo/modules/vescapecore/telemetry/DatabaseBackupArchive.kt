package expo.modules.vescapecore.telemetry

import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream
import org.json.JSONObject

internal const val BACKUP_MANIFEST_ENTRY = "manifest.json"
internal const val BACKUP_DATABASE_ENTRY = "db.sqlite"

/** Production backup container codec. Android adapters only supply the URI streams. */
internal object DatabaseBackupArchive {
  fun manifest(platform: String, schemaVersion: Int, appVersion: String, dbSizeBytes: Long, createdAt: Long): JSONObject =
    JSONObject(
      mapOf(
        "format" to "vesc-db-backup",
        "createdAt" to createdAt,
        "schemaVersion" to schemaVersion,
        "appVersion" to appVersion,
        "platform" to platform,
        "dbSizeBytes" to dbSizeBytes,
      ),
    )

  fun write(database: File, manifest: JSONObject, output: OutputStream, soundDirectory: File? = null) {
    ZipOutputStream(output).use { zip ->
      zip.putNextEntry(ZipEntry(BACKUP_MANIFEST_ENTRY))
      zip.write(manifest.toString().toByteArray(Charsets.UTF_8))
      zip.closeEntry()
      zip.putNextEntry(ZipEntry(BACKUP_DATABASE_ENTRY))
      database.inputStream().use { it.copyTo(zip) }
      zip.closeEntry()
      soundDirectory?.listFiles()?.filter { it.name == "packs.json" || Regex("[0-9a-fA-F-]{36}\\.wav").matches(it.name) }?.forEach { file ->
        zip.putNextEntry(ZipEntry("custom-app-sounds/${file.name}"))
        file.inputStream().use { it.copyTo(zip) }
        zip.closeEntry()
      }
    }
  }

  fun extract(input: InputStream, restoredDatabase: File, soundDirectory: File? = null): JSONObject {
    var manifest: JSONObject? = null
    ZipInputStream(input).use { zip ->
      generateSequence { zip.nextEntry }.forEach { entry ->
        when (entry.name) {
          BACKUP_MANIFEST_ENTRY -> manifest = JSONObject(zip.readBytes().toString(Charsets.UTF_8))
          BACKUP_DATABASE_ENTRY -> restoredDatabase.outputStream().use { zip.copyTo(it) }
          else -> if (soundDirectory != null && entry.name.startsWith("custom-app-sounds/")) {
            val name = entry.name.removePrefix("custom-app-sounds/")
            require(name == "packs.json" || Regex("[0-9a-fA-F-]{36}\\.wav").matches(name)) { "Invalid sound file name" }
            soundDirectory.mkdirs()
            File(soundDirectory, name).outputStream().use { output ->
              val buffer = ByteArray(8192)
              var copied = 0L
              while (true) {
                val count = zip.read(buffer)
                if (count < 0) break
                copied += count
                require(copied <= 2_000_000) { "Sound file too large" }
                output.write(buffer, 0, count)
              }
            }
          }
        }
        zip.closeEntry()
      }
    }
    require(restoredDatabase.exists() && restoredDatabase.length() > 0) { "Backup missing $BACKUP_DATABASE_ENTRY" }
    return requireNotNull(manifest) { "Backup missing $BACKUP_MANIFEST_ENTRY" }
  }
}
