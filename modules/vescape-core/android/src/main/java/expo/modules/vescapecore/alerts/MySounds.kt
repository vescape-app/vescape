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

/**
 * Effects slots a My sound can override. A set override wins over the active effects pack; voice
 * lines and geiger ticks are not overridable.
 *
 * @parity /modules/vescape-core/ios/alerts/MySounds.swift `soundOverrideSlots`
 * @parity /src/modules/settings/lib/appSounds.ts `SOUND_OVERRIDE_SLOTS`
 */
internal val SOUND_OVERRIDE_SLOTS = listOf(
  "severity.positive", "severity.info", "severity.warning", "severity.critical",
  "cue.on", "cue.off", "cue.groupRide.created", "cue.groupRide.joined",
)

/**
 * My sounds: the rider's audio library (WAV, M4A or MP3, ≤2 MB, ≤15 s) in `custom-app-sounds/`,
 * plus the override slots that point at it. `my-sounds.json` holds
 * `{ sounds: [{id, name}], overrides: {slot: id} }`; each sound's audio is `<id>.<wav|m4a|mp3>`,
 * the extension taken from the imported file's header.
 *
 * The custom app sound packs this replaces (`packs.json`) migrate on first read: every pack cue
 * becomes a My sound, and the pack that was selected becomes overrides once [adoptLegacyPack] sees
 * the `soundPack` setting.
 *
 * @parity /modules/vescape-core/ios/alerts/MySounds.swift
 */
internal object MySounds {
  private const val MAX_BYTES = 2_000_000L
  private const val MAX_DURATION_MS = 15_000L
  private const val MANIFEST = "my-sounds.json"
  private const val LEGACY_MANIFEST = "packs.json"
  private val AUDIO_EXTENSIONS = listOf("wav", "m4a", "mp3")

  /** Extension for an audio file starting with [header], null when it is not WAV, M4A or MP3. */
  internal fun audioExtension(header: ByteArray): String? {
    fun ascii(from: Int, to: Int) = if (header.size >= to) String(header, from, to - from, Charsets.US_ASCII) else ""
    val b0 = header.getOrNull(0)?.toInt()?.and(0xFF)
    val b1 = header.getOrNull(1)?.toInt()?.and(0xFF)
    return when {
      ascii(0, 4) == "RIFF" && ascii(8, 12) == "WAVE" -> "wav"
      ascii(4, 8) == "ftyp" -> "m4a"
      ascii(0, 3) == "ID3" -> "mp3"
      // MPEG audio frame sync with a nonzero layer (layer 0 is AAC ADTS).
      b0 == 0xFF && b1 != null && b1 and 0xE0 == 0xE0 && (b1 shr 1) and 3 != 0 -> "mp3"
      else -> null
    }
  }

  /** Name of My sound [id]'s audio in [dir], null when it has none. */
  private fun audioName(dir: File, id: String): String? =
    AUDIO_EXTENSIONS.map { "$id.$it" }.firstOrNull { mySoundFileName.matches(it) && File(dir, it).isFile }
  /**
   * Legacy pack cue → (override slot, label); its `join` was another rider joining. Error and
   * rider joined have no override slot, so they migrate as plain library sounds.
   */
  private val legacyCues = listOf<Pair<String, Pair<String?, String>>>(
    "on" to ("cue.on" to "Connect"), "off" to ("cue.off" to "Disconnect"), "error" to (null to "Error"),
    "created" to ("cue.groupRide.created" to "New Group Ride"), "join" to (null to "Rider joined"),
  )

  private data class Sound(val id: String, val name: String)
  private data class Store(
    val sounds: List<Sound> = emptyList(),
    val overrides: Map<String, String> = emptyMap(),
    /** Migrated pack id → its cues as overrides, waiting for [adoptLegacyPack]. */
    val legacyPacks: Map<String, Map<String, String>> = emptyMap(),
  )

  @Volatile private var cached: Pair<File, Store>? = null

  private fun directory(context: Context) = File(context.filesDir, "custom-app-sounds").apply { mkdirs() }

  private fun decode(text: String): Store {
    val json = JSONObject(text)
    val sounds = json.optJSONArray("sounds") ?: JSONArray()
    fun stringMap(obj: JSONObject?) = obj?.keys()?.asSequence()?.associateWith { obj.getString(it) }.orEmpty()
    // Overrides for slots that no longer exist are dropped.
    fun slotMap(obj: JSONObject?) = stringMap(obj).filterKeys { it in SOUND_OVERRIDE_SLOTS }
    val legacy = json.optJSONObject("legacyPacks")
    return Store(
      sounds = (0 until sounds.length()).map { sounds.getJSONObject(it).let { s -> Sound(s.getString("id"), s.getString("name")) } },
      overrides = slotMap(json.optJSONObject("overrides")),
      legacyPacks = legacy?.keys()?.asSequence()?.associateWith { slotMap(legacy.getJSONObject(it)) }.orEmpty(),
    )
  }

  private fun encode(store: Store): String = JSONObject()
    .put("sounds", JSONArray(store.sounds.map { JSONObject().put("id", it.id).put("name", it.name) }))
    .put("overrides", JSONObject(store.overrides))
    .apply { if (store.legacyPacks.isNotEmpty()) put("legacyPacks", JSONObject(store.legacyPacks.mapValues { JSONObject(it.value) })) }
    .toString()

  /** Custom app sound packs → My sounds; each pack's cues are kept for [adoptLegacyPack]. */
  private fun migrate(dir: File, packsJson: String): Store {
    val packs = JSONArray(packsJson)
    val sounds = mutableListOf<Sound>()
    val legacy = mutableMapOf<String, Map<String, String>>()
    for (i in 0 until packs.length()) {
      val pack = packs.getJSONObject(i)
      val cues = pack.optJSONObject("sounds") ?: continue
      val slots = mutableMapOf<String, String>()
      for ((cue, target) in legacyCues) {
        val (slot, label) = target
        val file = cues.optString(cue)
        if (!mySoundFileName.matches(file) || !File(dir, file).isFile) continue
        val id = file.substringBeforeLast('.')
        sounds += Sound(id, "${pack.optString("name")} $label".trim().take(60))
        if (slot != null) slots[slot] = id
      }
      if (slots.isNotEmpty()) legacy[pack.optString("id")] = slots
    }
    return Store(sounds, legacyPacks = legacy)
  }

  private fun read(context: Context): Store {
    val dir = directory(context)
    cached?.let { (cachedDir, store) -> if (cachedDir == dir) return store }
    val manifest = File(dir, MANIFEST)
    val legacy = File(dir, LEGACY_MANIFEST)
    val store = when {
      // intentional-suppression: an unreadable library reads as empty; pack slots keep playing
      manifest.exists() -> runCatching { decode(manifest.readText()) }.getOrDefault(Store())
      // intentional-suppression: an unreadable pack manifest stays on disk and reads as empty
      legacy.exists() -> runCatching { migrate(dir, legacy.readText()) }.getOrNull()
        ?.also { save(context, it); legacy.delete() } ?: Store()
      else -> Store()
    }
    cached = dir to store
    return store
  }

  private fun save(context: Context, store: Store) {
    val dir = directory(context)
    val temp = File(dir, "$MANIFEST.tmp")
    temp.writeText(encode(store))
    check(temp.renameTo(File(dir, MANIFEST))) { "Could not save My sounds" }
    cached = dir to store
  }

  private fun validatedName(name: String): String =
    name.trim().also { require(it.isNotEmpty() && it.length <= 60) { "Name must be 1–60 characters" } }

  @Synchronized fun state(context: Context): Map<String, Any> {
    val store = read(context)
    return mapOf(
      "sounds" to store.sounds.map { mapOf("id" to it.id, "name" to it.name) },
      "overrides" to store.overrides,
    )
  }

  @Synchronized fun import(context: Context, uri: String, name: String): Map<String, Any> {
    val clean = validatedName(name)
    val id = UUID.randomUUID().toString()
    val staged = File(directory(context), "$id.import")
    var target = staged
    try {
      context.contentResolver.openInputStream(Uri.parse(uri)).use { input ->
        requireNotNull(input) { "Could not open audio file" }
        staged.outputStream().use { output ->
          val buffer = ByteArray(8192)
          var bytes = 0L
          while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            bytes += count
            require(bytes <= MAX_BYTES) { "Audio must be under 2 MB" }
            output.write(buffer, 0, count)
          }
          require(bytes > 0) { "Empty audio file" }
        }
      }
      val header = ByteArray(12)
      val read = staged.inputStream().use { it.read(header) }
      val extension = requireNotNull(audioExtension(header.copyOf(maxOf(read, 0)))) { "Use a WAV, M4A or MP3 file" }
      target = File(directory(context), "$id.$extension")
      check(staged.renameTo(target)) { "Could not save audio file" }
      val retriever = MediaMetadataRetriever()
      try {
        try { retriever.setDataSource(target.absolutePath) }
        catch (_: Exception) { throw IllegalArgumentException("Audio could not be decoded") }
        val duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
        require(duration != null && duration in 1..MAX_DURATION_MS) { "Audio must be 15 seconds or shorter" }
      } finally { retriever.release() }
      val decoder = MediaPlayer()
      try {
        decoder.setDataSource(target.absolutePath)
        decoder.prepare()
      } catch (_: Exception) {
        throw IllegalArgumentException("Audio could not be decoded")
      } finally { decoder.release() }
      val store = read(context)
      save(context, store.copy(sounds = store.sounds + Sound(id, clean)))
    } catch (error: Exception) {
      target.delete()
      staged.delete()
      throw error
    }
    return state(context)
  }

  @Synchronized fun rename(context: Context, id: String, name: String): Map<String, Any> {
    val clean = validatedName(name)
    val store = read(context)
    require(store.sounds.any { it.id == id }) { "Sound missing" }
    save(context, store.copy(sounds = store.sounds.map { if (it.id == id) it.copy(name = clean) else it }))
    return state(context)
  }

  /** Delete a sound and every override using it; rules still naming it fall back to the pack. */
  @Synchronized fun delete(context: Context, id: String): Map<String, Any> {
    val store = read(context)
    require(store.sounds.any { it.id == id }) { "Sound missing" }
    save(context, store.copy(
      sounds = store.sounds.filter { it.id != id },
      overrides = store.overrides.filterValues { it != id },
      legacyPacks = store.legacyPacks.mapValues { (_, slots) -> slots.filterValues { it != id } },
    ))
    audioName(directory(context), id)?.let { File(directory(context), it).delete() }
    return state(context)
  }

  /** Point [slot] at My sound [id], or clear it back to the pack with null. */
  @Synchronized fun setOverride(context: Context, slot: String, id: String?): Map<String, Any> {
    require(slot in SOUND_OVERRIDE_SLOTS) { "Unknown sound slot" }
    val store = read(context)
    require(id == null || store.sounds.any { it.id == id }) { "Sound missing" }
    save(context, store.copy(overrides = if (id == null) store.overrides - slot else store.overrides + (slot to id)))
    return state(context)
  }

  /**
   * Finish the pack migration: the migrated pack the `soundPack` setting still names becomes
   * overrides (where none is set), then the pending packs are dropped.
   */
  @Synchronized fun adoptLegacyPack(context: Context, pack: String) {
    val store = read(context)
    if (store.legacyPacks.isEmpty()) return
    save(context, store.copy(overrides = store.legacyPacks[pack].orEmpty() + store.overrides, legacyPacks = emptyMap()))
  }

  /** Audio of My sound [id], null when it is gone or unreadable. */
  @Synchronized fun file(context: Context, id: String): File? {
    if (read(context).sounds.none { it.id == id }) return null
    val dir = directory(context)
    return audioName(dir, id)?.let { File(dir, it) }?.takeIf { it.length() in 1..MAX_BYTES }
  }

  /** Audio overriding effects [slot], null when the slot follows the pack. */
  @Synchronized fun overrideFile(context: Context, slot: String): File? =
    read(context).overrides[slot]?.let { file(context, it) }

  private val activePlayers = HashMap<MediaPlayer, Any?>()

  private fun finish(player: MediaPlayer, failed: Boolean, onDone: (Boolean) -> Unit) {
    val owned = synchronized(activePlayers) { activePlayers.containsKey(player).also { activePlayers.remove(player) } }
    player.setOnCompletionListener(null)
    player.setOnErrorListener(null)
    player.setOnPreparedListener(null)
    player.release()
    if (owned) onDone(failed)
  }

  /**
   * Play My sound [file] once through MediaPlayer, which takes a whole accepted clip (SoundPool
   * caps a decoded sample near 1 MB, about 6 s of 44.1 kHz stereo). [onDone] runs on completion
   * with `failed` true when it could not play, so the caller falls back to the pack slot. [onStart]
   * runs once playback has started.
   */
  fun play(file: File, source: String, owner: Any? = null, onStart: () -> Unit = {}, onDone: (failed: Boolean) -> Unit) {
    val player = MediaPlayer()
    synchronized(activePlayers) { activePlayers[player] = owner }
    try {
      player.setAudioAttributes(audioAttributes(source, AudioAttributes.CONTENT_TYPE_SONIFICATION))
      player.setDataSource(file.path)
      player.setOnPreparedListener {
        try { it.start(); onStart() }
        catch (_: Exception) { finish(it, true, onDone) }
      }
      player.setOnCompletionListener { finish(it, false, onDone) }
      player.setOnErrorListener { p, _, _ -> finish(p, true, onDone); true }
      player.prepareAsync()
    } catch (_: Exception) { finish(player, true, onDone) }
  }

  /** Stop and release every player [owner] started, without running their callbacks. */
  fun releasePlayers(owner: Any) {
    val players = synchronized(activePlayers) {
      activePlayers.filterValues { it === owner }.keys.toList().also { it.forEach(activePlayers::remove) }
    }
    players.forEach { player ->
      player.setOnCompletionListener(null)
      player.setOnErrorListener(null)
      player.setOnPreparedListener(null)
      player.release()
    }
  }

  private val durations = java.util.concurrent.ConcurrentHashMap<String, Long>()

  /** Length of My sound audio [file], 0 when unreadable. Read once per file. */
  fun durationMs(file: File): Long = durations.getOrPut(file.path) {
    // intentional-suppression: an unreadable length only falls back to the minimum spacing
    runCatching {
      MediaMetadataRetriever().run {
        try {
          setDataSource(file.path)
          extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
        } finally { release() }
      }
    }.getOrDefault(0L)
  }

  /** Copy metadata and its referenced files under the same store lock. */
  @Synchronized fun snapshotForBackup(context: Context, target: File, afterFileCopy: (String) -> Unit = {}) {
    val store = read(context)
    if (store.sounds.isEmpty()) return
    check(target.mkdirs()) { "Could not stage sound snapshot" }
    val source = directory(context)
    for (sound in store.sounds) {
      val name = requireNotNull(audioName(source, sound.id)) { "Sound file missing or invalid" }
      val file = File(source, name)
      require(file.isFile && file.length() in 1..MAX_BYTES) { "Sound file missing or invalid" }
      file.copyTo(File(target, name))
      afterFileCopy(name)
    }
    File(target, MANIFEST).writeText(encode(store))
  }

  /**
   * Validate and prune a candidate before its database is installed: sounds without audio and
   * overrides naming them are dropped. A backup from before My sounds carries `packs.json`, which
   * migrates on first read after restore.
   */
  @Synchronized fun validateBackup(staged: File) {
    val legacy = File(staged, LEGACY_MANIFEST)
    if (legacy.exists()) {
      val packs = JSONArray(legacy.readText())
      for (i in 0 until packs.length()) {
        val pack = packs.getJSONObject(i)
        require(pack.getString("id").isNotEmpty() && pack.getString("name").isNotEmpty()) { "Invalid sound pack" }
      }
    }
    val manifest = File(staged, MANIFEST)
    if (!manifest.exists()) return
    val store = decode(manifest.readText())
    val present = store.sounds.filter { audioName(staged, it.id) != null }
    val ids = present.map { it.id }.toSet()
    manifest.writeText(encode(store.copy(
      sounds = present,
      overrides = store.overrides.filter { (slot, id) -> slot in SOUND_OVERRIDE_SLOTS && id in ids },
      legacyPacks = store.legacyPacks.mapValues { (_, slots) -> slots.filterValues { it in ids } },
    )))
  }

  /** Install a validated candidate. A backup without sounds clears the library. */
  @Synchronized fun replaceFromBackup(context: Context, staged: File) {
    try {
      replaceSoundPackFiles(File(context.filesDir, "custom-app-sounds"), staged)
    } finally {
      cached = null
    }
  }
}
