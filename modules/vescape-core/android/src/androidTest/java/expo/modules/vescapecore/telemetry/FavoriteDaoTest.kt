package expo.modules.vescapecore.telemetry

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FavoriteDaoTest {
  private lateinit var database: TelemetryDatabase
  private lateinit var dao: TelemetryDao

  @Before
  fun setUp() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    database = Room.inMemoryDatabaseBuilder(context, TelemetryDatabase::class.java)
      .allowMainThreadQueries()
      .build()
    dao = database.telemetryDao()
  }

  @After
  fun tearDown() {
    database.close()
  }

  @Test
  fun favoriteCrudRoundTrip() = runBlocking {
    val older = favorite(id = "older", name = null, startMs = 1_000, updatedAt = 1_000)
    val newer = favorite(id = "newer", name = "Evening ride", startMs = 3_000, updatedAt = 3_000)

    dao.insertFavorite(older)
    dao.insertFavorite(newer)
    assertEquals(listOf(newer, older), dao.getFavorites())

    val renamed = newer.copy(name = "Night ride", endMs = 4_500, updatedAt = 4_500)
    assertEquals(1, dao.updateFavorite(renamed))
    assertEquals(renamed, dao.getFavorite(newer.id))

    assertEquals(1, dao.deleteFavorite(newer.id))
    assertNull(dao.getFavorite(newer.id))
    assertEquals(listOf(older), dao.getFavorites())
  }

  private fun favorite(
    id: String,
    name: String?,
    startMs: Long,
    updatedAt: Long,
  ) = FavoriteEntity(
    id = id,
    boardId = null,
    name = name,
    startMs = startMs,
    endMs = startMs + 1_000,
    createdAt = startMs,
    updatedAt = updatedAt,
    sampleCount = 10,
    gpsPointCount = 5,
    distanceCm = 120_000,
    movingDurationMs = 60_000,
    avgSpeedCentiKmh = 2_000,
    maxSpeedCentiKmh = 3_000,
    batteryUsedWhMilli = 1_500,
  )
}
