package expo.modules.vescapecore.alerts

import android.content.Context
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.mockito.Mockito.`when`
import org.mockito.Mockito.mock

class CustomAppSoundsSnapshotTest {
  @Test fun deleteWaitsUntilManifestAndReferencedAudioAreSnapshotted() {
    val root = Files.createTempDirectory("sound-snapshot-").toFile()
    val executor = Executors.newFixedThreadPool(2)
    try {
      val context = mock(Context::class.java)
      `when`(context.filesDir).thenReturn(root)
      val id = CustomAppSounds.create(context, "Pack").single()["id"] as String
      val live = root.resolve("custom-app-sounds")
      val name = "11111111-1111-1111-1111-111111111111.wav"
      val audio = ByteArray(2_000_000) { (it % 251).toByte() }
      live.resolve(name).writeBytes(audio)
      val packs = JSONArray(live.resolve("packs.json").readText())
      packs.getJSONObject(0).getJSONObject("sounds").put("on", name)
      live.resolve("packs.json").writeText(packs.toString())

      val copied = CountDownLatch(1)
      val resume = CountDownLatch(1)
      val snapshot = root.resolve("snapshot")
      val export = executor.submit {
        CustomAppSounds.snapshotForBackup(context, snapshot) {
          copied.countDown()
          check(resume.await(5, TimeUnit.SECONDS))
        }
      }
      assertTrue(copied.await(5, TimeUnit.SECONDS))
      val deleteStarted = CountDownLatch(1)
      val deletion = executor.submit {
        deleteStarted.countDown()
        CustomAppSounds.delete(context, id)
      }
      assertTrue(deleteStarted.await(5, TimeUnit.SECONDS))
      Thread.sleep(100)
      assertFalse(deletion.isDone)
      resume.countDown()
      export.get(5, TimeUnit.SECONDS)
      deletion.get(5, TimeUnit.SECONDS)

      val archivedPacks = JSONArray(snapshot.resolve("packs.json").readText())
      assertEquals(name, archivedPacks.getJSONObject(0).getJSONObject("sounds").getString("on"))
      assertTrue(snapshot.resolve(name).readBytes().contentEquals(audio))
      assertFalse(live.resolve(name).exists())
    } finally {
      executor.shutdownNow()
      root.deleteRecursively()
    }
  }
}
