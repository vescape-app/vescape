package expo.modules.vescapecore.telemetry

import java.io.File
import java.lang.reflect.Proxy
import java.net.URI
import java.nio.file.Files
import java.security.MessageDigest
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** @parity /modules/vescape-core/ios/telemetry/FavoriteMediaStoreTests.swift */
class FavoriteMediaTest {
  private lateinit var root: File
  private lateinit var rows: MutableList<FavoriteMediaEntity>
  private lateinit var store: FavoriteMediaStore

  @Before
  fun setUp() {
    root = Files.createTempDirectory("favorite-media-test").toFile()
    rows = mutableListOf()
    val dao = Proxy.newProxyInstance(
      TelemetryDao::class.java.classLoader,
      arrayOf(TelemetryDao::class.java),
    ) { _, method, args ->
      when (method.name) {
        "getFavorite" -> favorite()
        "getFavoriteMedia" -> rows.filter { it.favoriteId == args?.first() }
        "insertFavoriteMedia" -> {
          rows += args?.first() as FavoriteMediaEntity
          Unit
        }
        "deleteFavoriteMedia" -> if (rows.removeIf { it.id == args?.first() }) 1 else 0
        else -> throw UnsupportedOperationException(method.name)
      }
    } as TelemetryDao
    store = FavoriteMediaStore(root, dao) { uri -> File(uri).inputStream() }
  }

  @After
  fun tearDown() {
    root.deleteRecursively()
  }

  @Test
  fun `import copies bytes then publishes hash and manifest`() = runBlocking {
    val source = File(root.parentFile, "picked-${System.nanoTime()}.jpg")
    val bytes = "favorite bytes".toByteArray()
    source.writeBytes(bytes)
    try {
      val map = store.importMedia(
        mapOf(
          "favoriteId" to "favorite-1",
          "uri" to source.path,
          "capturedAtMs" to 1_234L,
          "mimeType" to "image/jpeg",
          "mediaKind" to "photo",
        ),
      )

      assertEquals(bytes.size.toLong(), map["byteCount"])
      assertEquals(
        MessageDigest.getInstance("SHA-256").digest(bytes)
          .joinToString("") { "%02x".format(it.toInt() and 0xff) },
        map["contentHash"],
      )
      assertTrue(File(URI(map["uri"] as String)).isFile)
      assertEquals(listOf(map["id"]), store.list("favorite-1").map { it["id"] })
    } finally {
      source.delete()
    }
  }

  @Test
  fun `read reconciliation removes missing rows and orphan files`() = runBlocking {
    rows += FavoriteMediaEntity(
      id = "missing",
      favoriteId = "favorite-1",
      capturedAt = 1_000,
      mimeType = "image/jpeg",
      mediaKind = "photo",
      byteCount = 1,
      contentHash = "00",
      createdAt = 1_000,
    )
    val directory = File(root, "favorite-1").apply { mkdirs() }
    val orphan = File(directory, "orphan.jpg").apply { writeBytes(byteArrayOf(1)) }
    val interrupted = File(directory, ".partial.import").apply { writeBytes(byteArrayOf(2)) }

    assertTrue(store.list("favorite-1").isEmpty())
    assertFalse(orphan.exists())
    assertFalse(interrupted.exists())
  }

  private fun favorite() = FavoriteEntity(
    id = "favorite-1",
    boardId = null,
    name = null,
    startMs = 1_000,
    endMs = 2_000,
    createdAt = 1_000,
    updatedAt = 1_000,
    sampleCount = 0,
    gpsPointCount = 0,
    distanceCm = null,
    movingDurationMs = 0,
    avgSpeedCentiKmh = 0,
    maxSpeedCentiKmh = 0,
    batteryUsedWhMilli = 0,
  )
}
