package expo.modules.vescapecore.telemetry

import java.io.File

/** Installs a staged SQLite file and restores the complete former file set on any failure. */
internal fun replaceDatabaseFiles(
  source: File,
  target: File,
  validateInstalled: (File) -> Unit,
) {
  val suffixes = listOf("", "-wal", "-shm")
  val rollbackDir = File(target.parentFile, "${target.name}.rollback")
  check(!rollbackDir.exists() || rollbackDir.deleteRecursively()) { "Could not clear database rollback directory" }
  check(rollbackDir.mkdirs()) { "Could not create database rollback directory" }
  val moved = mutableListOf<Pair<File, File>>()
  var cleanupRollback = false
  try {
    for (suffix in suffixes) {
      val current = File(target.path + suffix)
      if (!current.exists()) continue
      val saved = File(rollbackDir, target.name + suffix)
      check(current.renameTo(saved)) { "Could not preserve current database file ${current.name}" }
      moved += current to saved
    }
    source.copyTo(target, overwrite = false)
    validateInstalled(target)
    cleanupRollback = true
  } catch (restoreError: Exception) {
    val rollbackErrors = mutableListOf<Throwable>()
    for (suffix in suffixes) {
      val installed = File(target.path + suffix)
      if (installed.exists() && !installed.delete()) {
        rollbackErrors += IllegalStateException("Could not remove failed restored database file ${installed.name}")
      }
    }
    for ((original, saved) in moved) {
      if (!saved.renameTo(original)) {
        rollbackErrors += IllegalStateException("Could not roll back current database file ${original.name}")
      }
    }
    if (rollbackErrors.isEmpty()) {
      cleanupRollback = true
      throw restoreError
    }
    throw IllegalStateException(
      "Database install failed and rollback was incomplete; preserved recovery files at ${rollbackDir.path}",
      restoreError,
    ).also { combined -> rollbackErrors.forEach(combined::addSuppressed) }
  } finally {
    if (cleanupRollback && rollbackDir.exists()) {
      check(rollbackDir.deleteRecursively()) { "Could not clear database rollback directory" }
    }
  }
}
