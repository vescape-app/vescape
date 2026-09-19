package expo.modules.vescapecore.alerts

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaMetadataRetriever
import android.media.MediaPlayer
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** @parity /modules/vescape-core/ios/alerts/CustomAppSounds.swift */
internal object CustomAppSounds {
  private val cues = setOf("on", "off", "error", "created", "join")
  private const val maxBytes = 2_000_000L
  private const val maxDurationMs = 15_000L
  private fun directory(context: Context) = File(context.filesDir, "custom-app-sounds").apply { mkdirs() }
  private fun manifest(context: Context) = File(directory(context), "packs.json")
  private fun read(context: Context): JSONArray = try {
    JSONArray(manifest(context).readText())
  } catch (_: Exception) { JSONArray() }
  private fun save(context: Context, packs: JSONArray) {
    val target = manifest(context)
    val temp = File(target.parentFile, "packs.json.tmp")
    temp.writeText(packs.toString())
    check(temp.renameTo(target)) { "Could not save sound packs" }
  }
  private fun find(packs: JSONArray, id: String): Pair<Int, JSONObject>? {
    for (i in 0 until packs.length()) {
      val pack = packs.getJSONObject(i)
      if (pack.optString("id") == id) return i to pack
    }
    return null
  }
  @Synchronized fun list(context: Context): List<Map<String, Any>> {
    val packs = read(context)
    return (0 until packs.length()).map { i ->
      val pack = packs.getJSONObject(i)
      val sounds = pack.optJSONObject("sounds") ?: JSONObject()
      mapOf("id" to pack.getString("id"), "name" to pack.getString("name"),
        "sounds" to cues.filter { sounds.has(it) }.associateWith { sounds.getString(it) })
    }
  }
  @Synchronized fun exists(context: Context, id: String): Boolean = find(read(context), id) != null
  @Synchronized fun create(context: Context, name: String): List<Map<String, Any>> {
    val clean = name.trim()
    require(clean.isNotEmpty() && clean.length <= 60) { "Name must be 1–60 characters" }
    val packs = read(context)
    packs.put(JSONObject().put("id", UUID.randomUUID().toString()).put("name", clean).put("sounds", JSONObject()))
    save(context, packs)
    return list(context)
  }
  @Synchronized fun rename(context: Context, id: String, name: String) {
    val clean = name.trim()
    require(clean.isNotEmpty() && clean.length <= 60) { "Name must be 1–60 characters" }
    val packs = read(context)
    val pack = requireNotNull(find(packs, id)) { "Sound pack missing" }.second
    pack.put("name", clean)
    save(context, packs)
  }
  @Synchronized fun remove(context: Context, id: String, cue: String) {
    require(cue in cues) { "Unknown sound cue" }
    val packs = read(context)
    val pack = requireNotNull(find(packs, id)) { "Sound pack missing" }.second
    val old = pack.getJSONObject("sounds").optString(cue)
    pack.getJSONObject("sounds").remove(cue)
    save(context, packs)
    if (old.isNotEmpty()) File(directory(context), old).delete()
  }
  @Synchronized fun delete(context: Context, id: String) {
    val packs = read(context)
    val (index, pack) = requireNotNull(find(packs, id)) { "Sound pack missing" }
    val sounds = pack.getJSONObject("sounds")
    val names = cues.map { sounds.optString(it) }.filter { it.isNotEmpty() }
    packs.remove(index)
    save(context, packs)
    names.forEach { File(directory(context), it).delete() }
  }
  @Synchronized fun import(context: Context, id: String, cue: String, uri: String) {
    require(cue in cues) { "Unknown sound cue" }
    val packs = read(context)
    val pack = requireNotNull(find(packs, id)) { "Sound pack missing" }.second
    val name = "${UUID.randomUUID()}.wav"
    val target = File(directory(context), name)
    try {
      context.contentResolver.openInputStream(Uri.parse(uri)).use { input ->
        requireNotNull(input) { "Could not open audio file" }
        target.outputStream().use { output ->
          val buffer = ByteArray(8192)
          var bytes = 0L
          while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            bytes += count
            require(bytes <= maxBytes) { "WAV must be under 2 MB" }
            output.write(buffer, 0, count)
          }
          require(bytes > 0) { "Empty WAV file" }
        }
      }
      val header = ByteArray(12)
      target.inputStream().use { require(it.read(header) == 12) { "Invalid WAV file" } }
      require(String(header, 0, 4) == "RIFF" && String(header, 8, 4) == "WAVE") { "Only WAV files are supported" }
      val retriever = MediaMetadataRetriever()
      try {
        try { retriever.setDataSource(target.absolutePath) }
        catch (_: Exception) { throw IllegalArgumentException("WAV audio could not be decoded") }
        val duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
        require(duration != null && duration in 1..maxDurationMs) { "Audio must be 15 seconds or shorter" }
      } finally { retriever.release() }
      val decoder = MediaPlayer()
      try {
        decoder.setDataSource(target.absolutePath)
        decoder.prepare()
      } catch (_: Exception) {
        throw IllegalArgumentException("WAV audio could not be decoded")
      } finally { decoder.release() }
      val old = pack.getJSONObject("sounds").optString(cue)
      pack.getJSONObject("sounds").put(cue, name)
      save(context, packs)
      if (old.isNotEmpty()) File(directory(context), old).delete()
    } catch (error: Exception) {
      target.delete()
      throw error
    }
  }
  @Synchronized fun file(context: Context, id: String, cue: String): File? {
    if (cue !in cues) return null
    val pack = find(read(context), id)?.second ?: return null
    val name = pack.optJSONObject("sounds")?.optString(cue).orEmpty()
    if (!Regex("[0-9a-fA-F-]{36}\\.wav").matches(name)) return null
    return File(directory(context), name).takeIf { it.isFile && it.length() in 1..maxBytes }
  }
  fun play(context: Context, id: String, cue: String, source: String, onFailure: () -> Unit): Boolean {
    val sound = file(context, id, cue) ?: return false
    val player = MediaPlayer()
    return try {
      player.setAudioAttributes(audioAttributes(source, AudioAttributes.CONTENT_TYPE_SONIFICATION))
      player.setDataSource(sound.absolutePath)
      player.setOnPreparedListener {
        try { it.start() }
        catch (_: Exception) { it.release(); onFailure() }
      }
      player.setOnCompletionListener { it.release() }
      player.setOnErrorListener { p, _, _ -> p.release(); onFailure(); true }
      player.prepareAsync()
      true
    } catch (_: Exception) { player.release(); false }
  }
  /** Validate and prune a candidate before its database is installed. */
  @Synchronized fun validateBackup(staged: File) {
    val manifestFile = File(staged, "packs.json")
    if (manifestFile.exists()) {
      val packs = JSONArray(manifestFile.readText())
      for (i in 0 until packs.length()) {
        val pack = packs.getJSONObject(i)
        require(pack.getString("id").isNotEmpty() && pack.getString("name").isNotEmpty()) { "Invalid sound pack" }
        val sounds = pack.getJSONObject("sounds")
        for (cue in cues) {
          val name = sounds.optString(cue)
          if (name.isNotEmpty() && (!Regex("[0-9a-fA-F-]{36}\\.wav").matches(name) ||
                !File(staged, name).isFile)) sounds.remove(cue)
        }
      }
      manifestFile.writeText(packs.toString())
    }
  }

  /** Old backups contain no sound entries. A restore then clears packs and resets selection on read. */
  @Synchronized fun replaceFromBackup(context: Context, staged: File) {
    val destination = File(context.filesDir, "custom-app-sounds")
    val previous = File(context.filesDir, "custom-app-sounds-old")
    previous.deleteRecursively()
    if (destination.exists()) check(destination.renameTo(previous)) { "Could not stage old sound packs" }
    try {
      if (staged.exists()) check(staged.copyRecursively(destination, overwrite = true)) { "Could not restore sound files" }
      previous.deleteRecursively()
    } catch (error: Exception) {
      destination.deleteRecursively()
      if (previous.exists()) previous.renameTo(destination)
      throw error
    }
  }
}
