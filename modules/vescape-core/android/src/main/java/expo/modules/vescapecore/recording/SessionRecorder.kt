package expo.modules.vescapecore.recording

import expo.modules.vescapecore.service.SessionConfig

import expo.modules.vescapecore.protocol.LocationSnapshot
import expo.modules.vescapecore.service.VESC_SESSION_TAG

import android.content.Context
import android.net.Uri
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.io.FileWriter
import java.io.InputStream

// @parity /modules/vescape-core/ios/recording/SessionRecorder.swift `SessionRecorder`
internal class SessionRecorder(context: Context, private val boardConfig: SessionConfig) {
    private val store = DebugRecordingStore(context)
    private val startedAt = System.currentTimeMillis()
    private val writer: FileWriter
    val file: File

    init {
        file = store.createFile(boardConfig.deviceName)
        writer = FileWriter(file, false)
    }

    fun start() {
        write(
            JSONObject()
                .put("t", 0)
                .put("kind", "meta")
                .put("version", 1)
                .put("deviceName", boardConfig.deviceName)
                .put("deviceId", boardConfig.deviceId)
                .put("sessionKind", "board")
                .put("pollIntervalMs", boardConfig.pollIntervalMs)
                .put("startedAt", startedAt)
        )
        recordState("recording-started")
    }

    fun recordState(status: String, extra: Map<String, Any?> = emptyMap()) {
        val json = JSONObject()
            .put("t", elapsed())
            .put("kind", "session-state")
            .put("status", status)
        extra.forEach { (key, value) -> json.put(key, value) }
        write(json)
    }

    fun recordChunk(direction: String, bytes: ByteArray) {
        write(
            JSONObject()
                .put("t", elapsed())
                .put("kind", "ble-chunk")
                .put("direction", direction)
                .put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
        )
    }

    fun recordLocation(location: LocationSnapshot) {
        write(
            JSONObject()
                .put("t", elapsed())
                .put("kind", "location")
                .put("latitude", location.latitude)
                .put("longitude", location.longitude)
                .put("speedMps", location.speedMps)
                .put("bearingDeg", location.bearingDeg)
                .put("accuracyM", location.accuracyM)
                .put("altitudeM", location.altitudeM)
                .put("timestamp", location.timestamp)
        )
    }

    /**
     * The phone's compass bearing, pushed down from JS — the sensor is read there, so native cannot
     * observe it on its own. Recorded so a replay can drive the heading cone and Compass follow off
     * the real measured rotation instead of a stand-in derived from GPS course.
     *
     * @parity /modules/vescape-core/ios/recording/SessionRecorder.swift `recordPhoneHeading`
     */
    fun recordPhoneHeading(headingDeg: Double) {
        write(
            JSONObject()
                .put("t", elapsed())
                .put("kind", "phone-heading")
                .put("headingDeg", headingDeg)
        )
    }

    fun finish(status: String) {
        try {
            recordState(status)
            writer.flush()
            writer.close()
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Recording close failed: ${e.message}")
        }
    }

    private fun elapsed(): Long = System.currentTimeMillis() - startedAt

    private fun write(json: JSONObject) {
        try {
            writer.append(json.toString()).append('\n')
            writer.flush()
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Recording write failed: ${e.message}")
        }
    }
}

// @parity /modules/vescape-core/ios/recording/SessionRecorder.swift `DebugRecordingStore`
internal class DebugRecordingStore(private val context: Context) {
    private val dir: File
        get() = File(context.filesDir, "vesc-recordings").also { it.mkdirs() }

    fun createFile(deviceName: String): File {
        val safeName = deviceName.replace(Regex("[^A-Za-z0-9._-]+"), "-").trim('-').ifBlank { "vesc-board" }
        return File(dir, "${System.currentTimeMillis()}-$safeName.jsonl")
    }

    fun list(): List<Map<String, Any>> =
        dir.listFiles()
            ?.asSequence()
            ?.filter { it.isFile && it.extension == "jsonl" }
            ?.sortedByDescending { it.lastModified() }
            ?.map {
                mapOf(
                    "name" to it.name,
                    "createdAt" to it.lastModified(),
                    "sizeBytes" to it.length(),
                )
            }
            ?.toList()
            ?: emptyList()

    /** Stream a stored recording's `.jsonl` content, for replay (see `ReplayRecordings`). */
    fun openStream(name: String): InputStream = resolve(name).inputStream()

    /** Whether a valid recording name resolves to a stored file (no throw on absence). */
    fun exists(name: String): Boolean =
        File(name).name == name && name.endsWith(".jsonl") && File(dir, name).isFile

    private fun resolve(name: String): File {
        require(File(name).name == name && name.endsWith(".jsonl")) { "Invalid debug recording name" }
        val source = File(dir, name)
        require(source.isFile) { "Debug recording not found" }
        return source
    }

    fun export(name: String): Map<String, Any> {
        val source = resolve(name)

        val exportDir = File(context.cacheDir, "debug-recording-exports").also { it.mkdirs() }
        val export = File(exportDir, name)
        source.copyTo(export, overwrite = true)

        return mapOf(
            "uri" to Uri.fromFile(export).toString(),
            "name" to export.name,
            "sizeBytes" to export.length(),
        )
    }

    fun delete(name: String) {
        resolve(name).delete()
    }
}
