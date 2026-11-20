package expo.modules.vescapecore.replay

import expo.modules.vescapecore.recording.DebugRecordingStore

import android.content.Context
import java.io.File
import java.io.InputStream

/**
 * Resolves a replayable Debug Recording by name: the on-device store first, then the bundled
 * fixtures shipped in app assets (`assets/fixtures`, copied from `shared/fixtures/` by
 * `copy:shared`). Bundled fixtures make replay usable on a device with no captures yet.
 *
 * @parity /modules/vescape-core/ios/replay/ReplayRecordings.swift
 */
internal object ReplayRecordings {
    private const val ASSETS_DIR = "fixtures"

    fun read(context: Context, name: String): String =
        open(context, name).bufferedReader().use { it.readText() }

    private fun open(context: Context, name: String): InputStream {
        val store = DebugRecordingStore(context)
        if (store.exists(name)) return store.openStream(name)
        requireValidName(name)
        return context.assets.open("$ASSETS_DIR/$name")
    }

    /** Bundled fixture names + sizes, sorted by name (assets have no timestamps). */
    fun listBundled(context: Context): List<Map<String, Any>> =
        (context.assets.list(ASSETS_DIR) ?: emptyArray())
            .filter { it.endsWith(".jsonl") }
            .sorted()
            .map { name ->
                val sizeBytes = context.assets.open("$ASSETS_DIR/$name").use { stream ->
                    var total = 0L
                    val buffer = ByteArray(8 * 1024)
                    while (true) {
                        val read = stream.read(buffer)
                        if (read < 0) break
                        total += read
                    }
                    total
                }
                mapOf("name" to name, "sizeBytes" to sizeBytes)
            }

    private fun requireValidName(name: String) {
        require(File(name).name == name && name.endsWith(".jsonl")) { "Invalid debug recording name" }
    }
}
