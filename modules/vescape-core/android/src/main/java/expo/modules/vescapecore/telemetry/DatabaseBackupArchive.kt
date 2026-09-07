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

  fun write(database: File, manifest: JSONObject, output: OutputStream) {
    ZipOutputStream(output).use { zip ->
      zip.putNextEntry(ZipEntry(BACKUP_MANIFEST_ENTRY))
      zip.write(manifest.toString().toByteArray(Charsets.UTF_8))
      zip.closeEntry()
      zip.putNextEntry(ZipEntry(BACKUP_DATABASE_ENTRY))
      database.inputStream().use { it.copyTo(zip) }
      zip.closeEntry()
    }
  }

  fun extract(input: InputStream, restoredDatabase: File): JSONObject {
    var manifest: JSONObject? = null
    ZipInputStream(input).use { zip ->
      generateSequence { zip.nextEntry }.forEach { entry ->
        when (entry.name) {
          BACKUP_MANIFEST_ENTRY -> manifest = JSONObject(zip.readBytes().toString(Charsets.UTF_8))
          BACKUP_DATABASE_ENTRY -> restoredDatabase.outputStream().use { zip.copyTo(it) }
        }
        zip.closeEntry()
      }
    }
    require(restoredDatabase.exists() && restoredDatabase.length() > 0) { "Backup missing $BACKUP_DATABASE_ENTRY" }
    return requireNotNull(manifest) { "Backup missing $BACKUP_MANIFEST_ENTRY" }
  }
}
