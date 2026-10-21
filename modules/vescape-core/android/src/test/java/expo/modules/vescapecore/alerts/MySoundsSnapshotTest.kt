package expo.modules.vescapecore.alerts

import android.content.Context
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.mockito.Mockito.`when`
import org.mockito.Mockito.mock

class MySoundsSnapshotTest {
  private val onId = "11111111-1111-1111-1111-111111111111"
  private val errorId = "22222222-2222-2222-2222-222222222222"
  private val otherId = "33333333-3333-3333-3333-333333333333"

  private fun withStore(block: (Context, File) -> Unit) {
    val root = Files.createTempDirectory("my-sounds-").toFile()
    try {
      val context = mock(Context::class.java)
      `when`(context.filesDir).thenReturn(root)
      block(context, root.resolve("custom-app-sounds").apply { mkdirs() })
    } finally { root.deleteRecursively() }
  }

  @Test fun deleteWaitsUntilManifestAndReferencedAudioAreSnapshotted() = withStore { context, live ->
    val executor = Executors.newFixedThreadPool(2)
    try {
      val name = "$onId.wav"
      val audio = ByteArray(2_000_000) { (it % 251).toByte() }
      live.resolve(name).writeBytes(audio)
      live.resolve("my-sounds.json").writeText("""{"sounds":[{"id":"$onId","name":"Beep"}],"overrides":{}}""")

      val copied = CountDownLatch(1)
      val resume = CountDownLatch(1)
      val snapshot = live.parentFile!!.resolve("snapshot")
      val export = executor.submit {
        MySounds.snapshotForBackup(context, snapshot) {
          copied.countDown()
          check(resume.await(5, TimeUnit.SECONDS))
        }
      }
      assertTrue(copied.await(5, TimeUnit.SECONDS))
      val deleteStarted = CountDownLatch(1)
      val deletion = executor.submit {
        deleteStarted.countDown()
        MySounds.delete(context, onId)
      }
      assertTrue(deleteStarted.await(5, TimeUnit.SECONDS))
      Thread.sleep(100)
      assertFalse(deletion.isDone)
      resume.countDown()
      export.get(5, TimeUnit.SECONDS)
      deletion.get(5, TimeUnit.SECONDS)

      val archived = JSONObject(snapshot.resolve("my-sounds.json").readText())
      assertEquals(onId, archived.getJSONArray("sounds").getJSONObject(0).getString("id"))
      assertTrue(snapshot.resolve(name).readBytes().contentEquals(audio))
      assertFalse(live.resolve(name).exists())
    } finally {
      executor.shutdownNow()
    }
  }

  @Test fun customPacksMigrateToMySoundsAndTheSelectedPackBecomesOverrides() = withStore { context, live ->
    for (id in listOf(onId, errorId, otherId)) live.resolve("$id.wav").writeBytes(byteArrayOf(1))
    live.resolve("packs.json").writeText(
      """[{"id":"a","name":"Mine","sounds":{"on":"$onId.wav","error":"$errorId.wav","off":"gone.wav"}},
         {"id":"b","name":"Other","sounds":{"join":"$otherId.wav"}}]""",
    )

    @Suppress("UNCHECKED_CAST")
    val sounds = MySounds.state(context)["sounds"] as List<Map<String, String>>
    assertEquals(
      listOf(onId to "Mine Connect", errorId to "Mine Error", otherId to "Other Rider joined"),
      sounds.map { it["id"] to it["name"] },
    )
    assertFalse(live.resolve("packs.json").exists())
    assertEquals(emptyMap<String, String>(), MySounds.state(context)["overrides"])

    MySounds.adoptLegacyPack(context, "a")
    // Error has no override slot any more: it stays a plain library sound.
    assertEquals(mapOf("cue.on" to onId), MySounds.state(context)["overrides"])
    assertEquals(live.resolve("$onId.wav"), MySounds.overrideFile(context, "cue.on"))

    // Adoption is one-shot: the other pack's cues stay plain library sounds.
    MySounds.adoptLegacyPack(context, "b")
    assertNull(MySounds.overrideFile(context, "cue.groupRide.joined"))
  }

  @Test fun deletingASoundClearsItsOverride() = withStore { context, live ->
    live.resolve("$onId.wav").writeBytes(byteArrayOf(1))
    live.resolve("my-sounds.json").writeText("""{"sounds":[{"id":"$onId","name":"Beep"}],"overrides":{}}""")
    MySounds.setOverride(context, "severity.warning", onId)
    assertEquals(live.resolve("$onId.wav"), MySounds.overrideFile(context, "severity.warning"))
    MySounds.delete(context, onId)
    assertNull(MySounds.overrideFile(context, "severity.warning"))
    assertNull(MySounds.file(context, onId))
  }
}
