package expo.modules.vescapecore.telemetry

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.room.RoomDatabase.Callback
import androidx.room.migration.Migration
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.db.SupportSQLiteDatabase
import java.io.File
import java.io.FileInputStream
import java.nio.file.Files
import java.nio.file.NoSuchFileException
import java.io.IOException

/** Android lifecycle and Room adapters for the portable production migration graph. */
internal object TelemetryDatabase {
  @Volatile private var instance: TelemetryRoomDatabase? = null

  private class SupportDatabase(private val db: SupportSQLiteDatabase) : TelemetryMigrationDatabase {
    override fun execSQL(sql: String) = db.execSQL(sql)

    override fun hasColumn(tableName: String, columnName: String): Boolean =
      db.query("PRAGMA table_info($tableName)").use { cursor ->
        val nameIndex = cursor.getColumnIndex("name")
        while (cursor.moveToNext()) {
          if (cursor.getString(nameIndex) == columnName) return@use true
        }
        false
      }
  }

  private fun roomMigration(step: TelemetryMigrationStep) =
    object : Migration(step.startVersion, step.endVersion) {
      override fun migrate(db: SupportSQLiteDatabase) = step.migrate(SupportDatabase(db))

      override fun migrate(connection: SQLiteConnection) = step.migrate(connection)
    }

  private val roomMigrations = TelemetryMigrations.all.associate {
    (it.startVersion to it.endVersion) to roomMigration(it)
  }

  private fun migration(startVersion: Int, endVersion: Int): Migration =
    checkNotNull(roomMigrations[startVersion to endVersion]) {
      "Production migration $startVersion->$endVersion is not registered"
    }

  internal val MIGRATION_18_19 = migration(18, 19)
  internal val MIGRATION_19_20 = migration(19, 20)
  internal val MIGRATION_20_21 = migration(20, 21)
  internal val MIGRATION_21_22 = migration(21, 22)
  internal val MIGRATION_22_23 = migration(22, 23)
  internal val MIGRATION_23_24 = migration(23, 24)
  internal val MIGRATION_24_25 = migration(24, 25)
  internal val MIGRATION_25_26 = migration(25, 26)
  internal val MIGRATION_26_27 = migration(26, 27)
  internal val MIGRATION_27_28 = migration(27, 28)
  internal val MIGRATION_28_29 = migration(28, 29)
  internal val MIGRATION_29_30 = migration(29, 30)
  internal val MIGRATION_30_31 = migration(30, 31)
  internal val MIGRATION_31_32 = migration(31, 32)
  internal val MIGRATION_32_33 = migration(32, 33)
  internal val MIGRATION_33_34 = migration(33, 34)
  internal val MIGRATION_34_35 = migration(34, 35)
  internal val MIGRATION_35_36 = migration(35, 36)
  internal val MIGRATION_36_40 = migration(36, 40)
  internal val MIGRATION_40_41 = migration(40, 41)
  internal val MIGRATION_41_42 = migration(41, 42)

  internal fun migrateLegacyDatabaseFile(context: Context) {
    val target = context.getDatabasePath(TELEMETRY_DATABASE_NAME)
    val legacy = context.getDatabasePath(LEGACY_TELEMETRY_DATABASE_NAME)
    if (target.exists() || !legacy.exists()) return
    SQLiteDatabase.openDatabase(legacy.path, null, SQLiteDatabase.OPEN_READWRITE).use { db ->
      db.rawQuery("PRAGMA wal_checkpoint(TRUNCATE)", null).close()
    }
    val parent = target.parentFile
    if (parent != null && !parent.exists() && !parent.mkdirs()) {
      throw IOException("Could not create database directory")
    }
    moveLegacyDatabaseFile(legacy, target)
    File("${legacy.path}-wal").delete()
    File("${legacy.path}-shm").delete()
  }

  internal fun moveLegacyDatabaseFile(legacy: File, target: File) {
    if (!legacy.renameTo(target)) throw IOException("Could not migrate legacy database")
  }

  internal fun databaseSizeBytes(
    file: File,
    size: (File) -> Long = { source -> Files.size(source.toPath()) },
  ): Long {
    return try { size(file) }
    catch (_: NoSuchFileException) { 0L }
  }

  fun get(context: Context): TelemetryRoomDatabase =
    instance ?: synchronized(this) {
      migrateLegacyDatabaseFile(context.applicationContext)
      instance ?: Room.databaseBuilder(
        context.applicationContext,
        TelemetryRoomDatabase::class.java,
        TELEMETRY_DATABASE_NAME,
      )
        .addMigrations(*roomMigrations.values.toTypedArray())
        .addCallback(object : Callback() {
          override fun onOpen(db: SupportSQLiteDatabase) {
            db.execSQL("PRAGMA optimize")
          }
        })
        .build()
        .also { instance = it }
    }

  fun closeAndReset() {
    synchronized(this) {
      instance?.close()
      instance = null
    }
  }
}
