package expo.modules.vescapecore.alerts

import java.io.File

/** Install a staged pack tree, retaining the old tree until every file is copied. */
internal fun replaceSoundPackFiles(
  destination: File,
  staged: File,
  copyStaged: (File, File) -> Unit = { source, target ->
    check(source.copyRecursively(target, overwrite = true)) { "Could not restore sound files" }
  },
) {
  val previous = File(destination.parentFile, "custom-app-sounds-old")
  check(!previous.exists()) { "Previous sound recovery files still exist" }
  if (destination.exists()) check(destination.renameTo(previous)) { "Could not stage old sound packs" }
  try {
    if (staged.exists()) copyStaged(staged, destination)
    previous.deleteRecursively()
  } catch (error: Exception) {
    destination.deleteRecursively()
    if (previous.exists()) check(previous.renameTo(destination)) { "Could not roll back sound packs" }
    throw error
  }
}
