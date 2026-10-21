package expo.modules.vescapecore.maptiles

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.util.concurrent.atomic.AtomicInteger

/** @parity /modules/vescape-core/ios/maptiles/MapTilesTests.swift */
class MapTilesTest {
  @get:Rule val folder = TemporaryFolder()

  private val jpeg = byteArrayOf(1, 2, 3)

  @Test
  fun `concurrent requests for one tile share a download and later ones read the disk`() = runBlocking {
    val fetches = AtomicInteger()
    val release = CompletableDeferred<Unit>()
    val tiles = MapTiles(folder.root, { fetches.incrementAndGet(); release.await(); jpeg }, "pk.test")

    val first = async { tiles.tile(15, 17934, 10954) }
    val second = async { tiles.tile(15, 17934, 10954) }
    while (fetches.get() == 0) yield()
    release.complete(Unit)

    val file = first.await()!!
    assertEquals(file, second.await())
    assertArrayEquals(jpeg, file.readBytes())
    assertEquals(file, tiles.tile(15, 17934, 10954))
    assertEquals(1, fetches.get())
  }

  @Test
  fun `a failed download stores nothing and the next request retries`() = runBlocking {
    val fetches = AtomicInteger()
    val tiles = MapTiles(folder.root, { if (fetches.incrementAndGet() == 1) null else jpeg }, "pk.test")

    assertNull(tiles.tile(3, 4, 2))
    assertEquals(emptyList<java.io.File>(), folder.root.walk().filter { it.isFile }.toList())
    assertArrayEquals(jpeg, tiles.tile(3, 4, 2)!!.readBytes())
    assertEquals(2, fetches.get())
  }

  @Test
  fun `tiles outside the zoom's grid never reach the network`() = runBlocking {
    val fetches = AtomicInteger()
    val tiles = MapTiles(folder.root, { fetches.incrementAndGet(); jpeg }, "pk.test")

    assertNull(tiles.tile(2, 4, 0))
    assertNull(tiles.tile(2, 0, -1))
    assertNull(tiles.tile(-1, 0, 0))
    assertEquals(0, fetches.get())
  }
}
