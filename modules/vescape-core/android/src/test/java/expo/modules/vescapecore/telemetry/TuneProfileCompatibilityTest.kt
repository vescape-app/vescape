package expo.modules.vescapecore.telemetry

import androidx.sqlite.db.SupportSQLiteDatabase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.lang.reflect.Proxy

class TuneProfileCompatibilityTest {
  @Test
  fun profileMapIncludesRefloatBaseCompatibility() {
    val profile = TuneProfileEntity(
      id = "profile-1",
      boardId = "board-1",
      refloatBaseVersion = "1.3.0",
      name = "Main",
      fieldsJson = """{"kp":20}""",
      createdAt = 1000,
      updatedAt = 2000,
    )

    val map = profile.toMap()

    assertEquals("1.3.0", map["refloatBaseVersion"])
    assertEquals(mapOf("kp" to 20), map["fields"])
  }

  @Test
  fun tuneCompatibilityRejectsUnscopedAndNonBaseVersions() {
    assertEquals("1.3.0", validRefloatBaseVersion("1.3.0"))
    assertEquals("1.1", validRefloatBaseVersion("1.1"))
    assertEquals(null, validRefloatBaseVersion(""))
    assertEquals(null, validRefloatBaseVersion(null))
    assertEquals(null, validRefloatBaseVersion("1.3.0-preview2"))
    assertEquals(null, validRefloatBaseVersion("Refloat 1.3.0"))
  }

  @Test
  fun migrationAddsRefloatBaseCompatibilityScope() {
    val sql = mutableListOf<String>()
    val db = Proxy.newProxyInstance(
      SupportSQLiteDatabase::class.java.classLoader,
      arrayOf(SupportSQLiteDatabase::class.java),
    ) { _, method, args ->
      if (method.name == "execSQL") {
        sql += args?.firstOrNull() as String
        null
      } else {
        throw UnsupportedOperationException(method.name)
      }
    } as SupportSQLiteDatabase

    TelemetryDatabase.MIGRATION_23_24.migrate(db)

    assertTrue(sql.any { it == "ALTER TABLE tune_profiles ADD COLUMN refloat_base_version TEXT NOT NULL DEFAULT ''" })
    assertTrue(
      sql.any {
        it == "CREATE INDEX IF NOT EXISTS index_tune_profiles_board_id_refloat_base_version ON tune_profiles(board_id, refloat_base_version)"
      },
    )
  }
}
