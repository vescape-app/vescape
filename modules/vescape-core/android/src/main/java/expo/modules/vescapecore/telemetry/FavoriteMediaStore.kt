package expo.modules.vescapecore.telemetry

import android.content.Context
import android.net.Uri
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.security.DigestInputStream
import java.security.MessageDigest
import java.util.UUID

/**
 * Native Favorite Media import and reconciliation (ADR 0030).
 *
 * @parity /modules/vescape-core/ios/telemetry/FavoriteMediaStore.swift
 */
internal class FavoriteMediaStore(
  private val root: File,
  private val dao: TelemetryDao,
  private val sourceOpener: (String) -> InputStream,
) {
  constructor(context: Context, dao: TelemetryDao) : this(
    root = File(context.filesDir, "favoriteMedia"),
    dao = dao,
    sourceOpener = { uri ->
      context.contentResolver.openInputStream(Uri.parse(uri))
        ?: Uri.parse(uri).path?.let(::File)?.takeIf(File::isFile)?.let(::FileInputStream)
        ?: error("Could not open media source")
    },
  )

  suspend fun list(favoriteId: String): List<Map<String, Any?>> {
    reconcile(favoriteId)
    return dao.getFavoriteMedia(favoriteId).map { media ->
      val file = fileFor(media)
      media.toMap(file.toURI().toString(), file.name)
    }
  }

  suspend fun importMedia(options: Map<String, Any?>): Map<String, Any?> {
    val favoriteId = options["favoriteId"] as? String ?: error("favoriteId is required")
    check(dao.getFavorite(favoriteId) != null) { "Favorite does not exist" }
    val sourceUri = options["uri"] as? String ?: error("uri is required")
    val mimeType = options["mimeType"] as? String ?: error("mimeType is required")
    val mediaKind = options["mediaKind"] as? String ?: error("mediaKind is required")
    require(mimeType.isNotEmpty() && mediaKind in setOf("photo", "video")) {
      "Invalid Favorite Media type"
    }
    val capturedAt = (options["capturedAtMs"] as? Number)?.toLong()
    val id = UUID.randomUUID().toString()
    val directory = favoriteDirectory(favoriteId).apply { mkdirs() }
    val temporary = File(directory, ".$id.import")
    val seed = FavoriteMediaEntity(
      id = id,
      favoriteId = favoriteId,
      capturedAt = capturedAt,
      mimeType = mimeType,
      mediaKind = mediaKind,
      byteCount = 0,
      contentHash = "",
      createdAt = System.currentTimeMillis(),
    )
    val destination = fileFor(seed)
    val digest = MessageDigest.getInstance("SHA-256")
    val byteCount = try {
      sourceOpener(sourceUri).use { raw ->
        DigestInputStream(raw, digest).use { input ->
          temporary.outputStream().use { output -> input.copyTo(output) }
        }
      }
      check(temporary.renameTo(destination)) { "Could not publish imported file" }
      destination.length()
    } catch (error: Throwable) {
      temporary.delete()
      throw error
    }
    val completed = seed.copy(
      byteCount = byteCount,
      contentHash = digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) },
    )
    try {
      dao.insertFavoriteMedia(completed)
    } catch (error: Throwable) {
      destination.delete()
      throw error
    }
    return completed.toMap(destination.toURI().toString(), destination.name)
  }

  suspend fun reconcile(favoriteId: String) {
    val rows = dao.getFavoriteMedia(favoriteId)
    val expected = rows.associateBy { fileFor(it).name }
    rows.filter { !fileFor(it).isFile }.forEach { dao.deleteFavoriteMedia(it.id) }
    favoriteDirectory(favoriteId).listFiles()?.forEach { file ->
      if (file.name.startsWith(".") || file.name !in expected) file.deleteRecursively()
    }
  }

  fun deleteDirectory(favoriteId: String) {
    favoriteDirectory(favoriteId).deleteRecursively()
  }

  /** Repair manifest/filesystem disagreement on the normal Favorites read path. */
  suspend fun reconcileAll() {
    dao.deleteOrphanFavoriteMedia()
    val favoriteIds = dao.getFavorites().mapTo(mutableSetOf()) { it.id }
    favoriteIds.forEach { reconcile(it) }
    root.listFiles()?.forEach { directory ->
      if (directory.name !in favoriteIds) directory.deleteRecursively()
    }
  }

  private fun favoriteDirectory(favoriteId: String) = File(root, favoriteId)

  private fun fileFor(media: FavoriteMediaEntity) =
    File(favoriteDirectory(media.favoriteId), "${media.id}.${extensionForMimeType(media.mimeType)}")

  private fun extensionForMimeType(mimeType: String): String = when (mimeType.lowercase()) {
    "image/png" -> "png"
    "image/heic", "image/heif" -> "heic"
    "image/webp" -> "webp"
    "video/quicktime" -> "mov"
    "video/webm" -> "webm"
    "video/x-m4v" -> "m4v"
    "video/mp4" -> "mp4"
    else -> if (mimeType.startsWith("video/")) "mp4" else "jpg"
  }
}
