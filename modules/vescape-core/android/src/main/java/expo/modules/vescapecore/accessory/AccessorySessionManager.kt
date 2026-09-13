package expo.modules.vescapecore.accessory

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import expo.modules.vescapecore.recording.RecordingStorageFailure
import expo.modules.vescapecore.service.CoreForegroundService
import expo.modules.vescapecore.telemetry.AccessoryPersistence
import expo.modules.vescapecore.telemetry.SavedAccessoryEntity
import expo.modules.vescapecore.telemetry.TelemetryDatabase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

/**
 * Enrolled Accessories: what is saved, what is connected, and the sessions in between.
 *
 * The durable half lives in the database and the live half in [AccessoryLink]; this object is the
 * only place the two meet. Two rules shape it:
 *
 * - **Only enrolled Accessories auto-connect.** Discovery finds hardware; the rider adds it. A
 *   device that merely advertises nearby is never given a session, so nothing on it can be started
 *   by walking past it.
 * - **Identity is the manifest's accessory id.** Enrollment reads a manifest natively rather than
 *   trusting one handed over the bridge, and every reconnect re-reads it. A renamed unit updates
 *   its row; a different unit on a remembered handle is refused.
 *
 * JS never drives any of this. The launch path starts sessions with or without a JS runtime, and
 * the bridge only sends intents (enroll, forget) and renders the snapshot.
 *
 * @parity /modules/vescape-core/ios/accessory/AccessorySessionController.swift
 */
object AccessorySessionManager {
    /** Set by the Expo module so state can be pushed without holding a module reference. */
    var emit: ((String, Map<String, Any?>) -> Unit)? = null

    private val handler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val links = LinkedHashMap<String, AccessoryLink>()
    private val saved = LinkedHashMap<String, SavedAccessoryEntity>()

    /**
     * The last snapshot built on the main looper.
     *
     * The bridge's synchronous getter runs on the JS thread while [saved] and [links] are written
     * from the main looper; iterating them from two threads is a `ConcurrentModificationException`
     * waiting for a badly timed render. Publishing an immutable list instead means the getter never
     * touches the live maps.
     */
    @Volatile private var published: List<Map<String, Any?>> = emptyList()

    private var appContext: Context? = null

    /**
     * Brings up every enrolled Accessory's session.
     *
     * Called from process launch, not from JS coming up. Safe to call repeatedly: a link already
     * started is left alone.
     */
    fun start(context: Context) {
        val app = context.applicationContext
        appContext = app
        scope.launch {
            val rows = try {
                persistence(app).getAccessories()
            } catch (error: Throwable) {
                // Nothing starts, and the outage is reported rather than looking like "no
                // Accessories" — a rider whose database is unreadable has not lost their hardware.
                RecordingStorageFailure.reportRead("accessory_list", error)
                return@launch
            }
            handler.post {
                saved.clear()
                rows.forEach { saved[it.accessoryId] = it }
                rows.forEach { link(it).start(it.deviceId) }
                publish()
            }
        }
    }

    /** True when at least one Accessory is enrolled, so a host lifetime is worth holding open. */
    fun hasSessions(): Boolean = links.isNotEmpty()

    fun stopAll() {
        handler.post {
            links.values.forEach { it.stop() }
            links.clear()
            publish()
        }
    }

    /**
     * Adds one Accessory the rider picked, by reading its manifest natively first.
     *
     * The manifest is never taken from the bridge. JS supplies a device handle it saw in a scan;
     * identity, protocol version and capability limits are all decided here, so an enrollment can
     * only ever record what the hardware actually said.
     */
    fun enroll(context: Context, deviceId: String, onResult: (Map<String, Any?>) -> Unit) {
        val app = context.applicationContext
        appContext = app
        AccessoryDiscovery.inspect(app, deviceId) { inspection ->
            @Suppress("UNCHECKED_CAST")
            val manifestMap = inspection["manifest"] as? Map<String, Any?>
            if (manifestMap == null) {
                onResult(mapOf("accessoryId" to null, "error" to (inspection["error"] ?: "connect-failed")))
                return@inspect
            }
            val accessoryId = manifestMap["accessoryId"] as? String
            if (accessoryId.isNullOrBlank()) {
                onResult(mapOf("accessoryId" to null, "error" to "invalid"))
                return@inspect
            }
            val row = SavedAccessoryEntity(
                accessoryId = accessoryId,
                name = manifestMap["name"] as? String ?: accessoryId,
                firmwareVersion = manifestMap["firmwareVersion"] as? String ?: "",
                protocolVersion = (manifestMap["protocolVersion"] as? Number)?.toInt(),
                deviceId = deviceId,
                capabilitiesJson = encodeCapabilities(manifestMap["capabilities"]),
                enrolledAt = System.currentTimeMillis(),
                lastConnectedAt = null,
            )
            scope.launch {
                val stored = try {
                    persistence(app).upsert(row)
                } catch (error: Throwable) {
                    RecordingStorageFailure.report("accessory_enroll", "write_failed", error)
                    onResult(mapOf("accessoryId" to null, "error" to "storage-unavailable"))
                    return@launch
                }
                handler.post {
                    saved[accessoryId] = stored
                    link(stored).start(deviceId)
                    publish()
                    onResult(mapOf("accessoryId" to accessoryId, "error" to null))
                }
                // The first enrollment arrives when no host is running: process-start auto-connect
                // already looked and found nothing enrolled. Without this the new link would live
                // in a bare app process and die the moment the rider backgrounds the app.
                CoreForegroundService.autoConnectAccessories(app)
            }
        }
    }

    /** Drops the saved identity and the session with it. Forgetting is the only way one goes away. */
    fun forget(context: Context, accessoryId: String, onResult: (Boolean) -> Unit) {
        val app = context.applicationContext
        appContext = app
        scope.launch {
            val removed = try {
                persistence(app).forget(accessoryId)
            } catch (error: Throwable) {
                // The saved identity is still there, so the Accessory is still enrolled. Tearing
                // down the live session anyway would make it come back on the next launch with no
                // explanation.
                RecordingStorageFailure.report("accessory_forget", "write_failed", error)
                onResult(false)
                return@launch
            }
            handler.post {
                links.remove(accessoryId)?.stop()
                saved.remove(accessoryId)
                publish()
                onResult(removed)
            }
        }
    }

    /**
     * Current snapshot, for a late subscriber or a JS foreground restore.
     *
     * The bridge's synchronous getter reads this off the JS thread while the maps are only written
     * from the main looper. That is a read of a consistent-enough render state, not a claim of
     * atomicity: the next `onAccessoryState` corrects anything caught mid-change.
     */
    fun snapshot(): List<Map<String, Any?>> = published

    private fun buildSnapshot(): List<Map<String, Any?>> = saved.values.map { row ->
        val link = links[row.accessoryId]
        val live = link?.manifest
        mapOf(
            "accessoryId" to row.accessoryId,
            // The live manifest wins while one is held: an Accessory renamed since enrollment reads
            // as its current name straight away, and the saved row catches up on the same handshake.
            "name" to (live?.name ?: row.name),
            "firmwareVersion" to (live?.firmwareVersion ?: row.firmwareVersion),
            "protocolVersion" to (live?.protocolVersion ?: row.protocolVersion),
            "deviceId" to row.deviceId,
            "enrolledAt" to row.enrolledAt,
            "lastConnectedAt" to row.lastConnectedAt,
            "phase" to (link?.phase ?: AccessoryLinkPhase.IDLE).wire,
            "error" to link?.lastError,
            "compatibility" to live?.compatibility?.wire,
            "capabilities" to (live?.capabilities?.map { it.toMap() } ?: decodeCapabilities(row.capabilitiesJson)),
            // Derived from the frozen baseline rather than remembered in memory: a flag held only
            // for the life of the process would clear itself on the next launch, which is the one
            // moment the rider is least likely to be looking.
            "capabilitiesChanged" to (
                live != null && encodeCapabilityList(live.capabilities) != row.capabilitiesJson
                ),
            "leaseHeldMs" to link?.lastAckAtMs?.let { SystemClock.elapsedRealtime() - it },
        )
    }

    private fun publish() {
        val snapshot = buildSnapshot()
        published = snapshot
        emit?.invoke("onAccessoryState", mapOf("accessories" to snapshot))
    }

    // MARK: - Internals

    private fun persistence(context: Context) =
        AccessoryPersistence(TelemetryDatabase.get(context).telemetryDao())

    private fun link(row: SavedAccessoryEntity): AccessoryLink =
        links.getOrPut(row.accessoryId) {
            AccessoryLink(
                context = requireNotNull(appContext) { "AccessorySessionManager used before start" },
                handler = handler,
                accessoryId = row.accessoryId,
                onChanged = { publish() },
                onManifest = { manifest, deviceId -> onManifestValidated(manifest, deviceId) },
            ).also { it.setDesiredAll(row) }
        }

    /**
     * A handshake that produced a manifest for an Accessory we have saved.
     *
     * The row is refreshed from what the hardware just said — name, firmware, protocol version, the
     * handle it answered on — and the capability set is compared against the one enrollment
     * validated. A capability whose limits moved is flagged rather than silently accepted: saved
     * calibration was made against the old numbers.
     */
    private fun onManifestValidated(manifest: AccessoryManifest, deviceId: String) {
        val previous = saved[manifest.accessoryId] ?: return
        // `capabilitiesJson` is deliberately carried over unchanged. It is the baseline the rider's
        // saved settings were validated against, and the snapshot derives "limits changed" by
        // comparing the live manifest against it; rewriting it here would answer the question with
        // the very thing being questioned.
        val row = previous.copy(
            name = manifest.name,
            firmwareVersion = manifest.firmwareVersion,
            protocolVersion = manifest.protocolVersion,
            deviceId = deviceId,
            lastConnectedAt = System.currentTimeMillis(),
        )
        saved[manifest.accessoryId] = row
        links[manifest.accessoryId]?.setDesiredAll(row, manifest)
        val app = appContext ?: return
        scope.launch {
            try {
                // Update-only: a handshake completing just as the rider forgets this Accessory must
                // not write the row back.
                persistence(app).revalidate(row)
            } catch (error: Throwable) {
                // The session is live and correct; only the saved copy of what the manifest just
                // said is stale, which the next successful handshake fixes.
                RecordingStorageFailure.report("accessory_revalidate", "write_failed", error)
            }
        }
    }

    /**
     * The baseline every session establishes for each capability it can drive.
     *
     * Both are the protocol's own neutral state, not a feature: a clearance sensor is held in
     * measurement standby, and a light is told plainly that Board telemetry is unavailable. They
     * exist so the session has a real acknowledged command to hold — which is what makes the lease,
     * the retry and the expiry observable before any capability's own behaviour is built. The
     * slices that own those capabilities replace these with the rider's actual demand.
     */
    private fun AccessoryLink.setDesiredAll(
        row: SavedAccessoryEntity,
        manifest: AccessoryManifest? = null,
    ) {
        val capabilities = manifest?.capabilities
            ?: decodeCapabilities(row.capabilitiesJson).mapNotNull(::capabilityFromMap)
        for (capability in capabilities) {
            if (!capability.supported) continue
            when (capability.type) {
                AccessoryProtocol.TYPE_GROUND_CLEARANCE -> {
                    val rate = AccessorySession.resolveRateHz(PREFERRED_RATE_HZ, capability.ratesHz)
                        ?: continue
                    setDesired(AccessoryCommand.Configure(capability.id, enabled = false, rateHz = rate))
                }

                AccessoryProtocol.TYPE_BRAKE_LIGHT -> setDesired(
                    AccessoryCommand.State(
                        capabilityId = capability.id,
                        telemetry = "unavailable",
                        mode = null,
                        parked = "off",
                    ),
                )

                else -> Unit
            }
        }
    }

    /** `docs/accessory-protocol.md` PoC default, resolved against whatever the manifest offers. */
    private const val PREFERRED_RATE_HZ = 20.0

    /**
     * The capability set as one canonical line.
     *
     * Built by hand with a fixed key order rather than through [JSONObject], which does not promise
     * one: this text is compared against the stored text to decide whether an Accessory's declared
     * limits moved, and it travels between platforms inside a database backup. Two encodings of the
     * same capabilities must be the same bytes on both, or restoring a backup would claim every
     * Accessory changed.
     *
     * @parity /modules/vescape-core/ios/accessory/AccessorySessionController.swift `encodeCapabilities`
     */
    private fun encodeCapabilities(raw: Any?): String {
        @Suppress("UNCHECKED_CAST")
        val list = raw as? List<Map<String, Any?>> ?: return "[]"
        return list.joinToString(",", prefix = "[", postfix = "]", transform = ::capabilityJson)
    }

    private fun encodeCapabilityList(capabilities: List<AccessoryCapability>): String =
        encodeCapabilities(capabilities.map { it.toMap() })

    private fun capabilityJson(entry: Map<String, Any?>): String = buildString {
        append("{\"id\":").append(JSONObject.quote(entry["id"] as? String ?: ""))
        append(",\"type\":").append(JSONObject.quote(entry["type"] as? String ?: ""))
        append(",\"supported\":").append(entry["supported"] == true)
        append(",\"unit\":").append((entry["unit"] as? String)?.let(JSONObject::quote) ?: "null")
        append(",\"rangeMin\":").append(numberOrNull(entry["rangeMin"]))
        append(",\"rangeMax\":").append(numberOrNull(entry["rangeMax"]))
        append(",\"ratesHz\":[")
        val rates = (entry["ratesHz"] as? List<*>).orEmpty().mapNotNull { it as? Number }
        append(rates.joinToString(",") { number(it.toDouble()) })
        append("]}")
    }

    private fun numberOrNull(value: Any?): String =
        (value as? Number)?.let { number(it.toDouble()) } ?: "null"

    private fun number(value: Double): String =
        if (value.isFinite() && value == Math.floor(value) && Math.abs(value) < 1e15) {
            value.toLong().toString()
        } else {
            value.toString()
        }

    private fun decodeCapabilities(json: String): List<Map<String, Any?>> {
        val root = try {
            JSONTokener(json).nextValue()
        } catch (e: Exception) {
            return emptyList()
        }
        if (root !is JSONArray) return emptyList()
        return (0 until root.length()).mapNotNull { index ->
            val entry = root.optJSONObject(index) ?: return@mapNotNull null
            mapOf(
                "id" to entry.optString("id"),
                "type" to entry.optString("type"),
                "supported" to entry.optBoolean("supported"),
                "unit" to if (entry.isNull("unit")) null else entry.optString("unit"),
                "rangeMin" to if (entry.isNull("rangeMin")) null else entry.optDouble("rangeMin"),
                "rangeMax" to if (entry.isNull("rangeMax")) null else entry.optDouble("rangeMax"),
                "ratesHz" to entry.optJSONArray("ratesHz")?.let { rates ->
                    (0 until rates.length()).map { rates.optDouble(it) }
                }.orEmpty(),
            )
        }
    }

    private fun capabilityFromMap(entry: Map<String, Any?>): AccessoryCapability? {
        val id = entry["id"] as? String ?: return null
        val type = entry["type"] as? String ?: return null
        @Suppress("UNCHECKED_CAST")
        return AccessoryCapability(
            id = id,
            type = type,
            supported = entry["supported"] == true,
            unit = entry["unit"] as? String,
            rangeMin = (entry["rangeMin"] as? Number)?.toDouble(),
            rangeMax = (entry["rangeMax"] as? Number)?.toDouble(),
            ratesHz = (entry["ratesHz"] as? List<Double>).orEmpty(),
        )
    }
}
