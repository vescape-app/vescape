package expo.modules.vescapecore.accessory

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import expo.modules.vescapecore.recording.RecordingStorageFailure
import expo.modules.vescapecore.service.CoreForegroundService
import expo.modules.vescapecore.database.AccessoryBrakeLightEntity
import expo.modules.vescapecore.database.AccessoryCapabilitySettingsEntity
import expo.modules.vescapecore.database.AccessoryGroundClearanceEntity
import expo.modules.vescapecore.telemetry.AccessoryPersistence
import expo.modules.vescapecore.database.SavedAccessoryEntity
import expo.modules.vescapecore.database.VescapeDatabase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

/**
 * @parity /modules/vescape-core/ios/accessory/AccessorySessionController.swift
 */
object AccessorySessionManager {
    var emit: ((String, Map<String, Any?>) -> Unit)? = null

    private val handler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /**
     * @parity /modules/vescape-core/ios/accessory/AccessorySessionController.swift `saveGroundClearance`
     * @platform-diff iOS writes these on the main queue inside `onMain`, which already orders them.
     */
    private val calibrationScope =
        CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(1))

    private val calibrationSeq = HashMap<GroundClearanceBindingController.Key, Long>()

    private val links = LinkedHashMap<String, AccessoryLink>()
    private val saved = LinkedHashMap<String, SavedAccessoryEntity>()
    private val capabilityEnabled = HashMap<GroundClearanceBindingController.Key, Boolean>()
    private val samplingRates = HashMap<GroundClearanceBindingController.Key, Double>()
    private val capabilityMutations = HashMap<GroundClearanceBindingController.Key, Long>()

    private val brakeLight = BrakeLightController()
    private val lightSaveMutex = Mutex()
    private val lightMutations = HashMap<BrakeLightController.Key, Long>()
    private val lightExpiry = Runnable {
        brakeLight.clear()
        reapplyDemand()
        publish()
    }

    private val groundClearance = GroundClearanceBindingController(SystemClock::elapsedRealtime)

    @Volatile private var published: List<Map<String, Any?>> = emptyList()

    private var appContext: Context? = null

    fun start(context: Context) {
        val app = context.applicationContext
        appContext = app
        scope.launch {
            val store = persistence(app)
            val rows = try {
                store.getAccessories()
            } catch (error: Throwable) {
                RecordingStorageFailure.reportRead("accessory_list", error)
                return@launch
            }
            val calibrations = try {
                store.getGroundClearances()
            } catch (error: Throwable) {
                RecordingStorageFailure.reportRead("accessory_ground_clearance", error)
                emptyList()
            }
            val capabilitySettings = try {
                store.getCapabilitySettings()
            } catch (error: Throwable) {
                RecordingStorageFailure.reportRead("accessory_capability_settings", error)
                return@launch
            }
            val lightSettings = try { store.getBrakeLights() } catch (error: Throwable) {
                RecordingStorageFailure.reportRead("accessory_brake_light", error)
                emptyList()
            }
            handler.post {
                capabilityEnabled.clear()
                samplingRates.clear()
                capabilitySettings.forEach {
                    val key = GroundClearanceBindingController.Key(it.accessoryId, it.capabilityId)
                    capabilityEnabled[key] = it.enabled
                    it.samplingRateHz?.let { rate -> samplingRates[key] = rate }
                }
                lightSettings.forEach { brakeLight.configure(BrakeLightController.Key(it.accessoryId, it.capabilityId), BrakeLightSettings(it.sensitivity, it.parked)) }
                saved.clear()
                rows.forEach { saved[it.accessoryId] = it }
                groundClearance.reset(calibrations.map { row ->
                    GroundClearanceBindingController.Key(row.accessoryId, row.capabilityId) to row.toCalibration()
                })
                rows.forEach { link(it).start(it.deviceId) }
                publish()
            }
        }
    }

    fun hasSessions(): Boolean = links.isNotEmpty()

    fun stopAll() {
        handler.post {
            links.values.forEach { it.stop() }
            links.clear()
            publish()
        }
    }

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
                CoreForegroundService.autoConnectAccessories(app)
            }
        }
    }

    fun forget(context: Context, accessoryId: String, onResult: (Boolean) -> Unit) {
        val app = context.applicationContext
        appContext = app
        scope.launch {
            val removed = try {
                persistence(app).forget(accessoryId)
            } catch (error: Throwable) {
                RecordingStorageFailure.report("accessory_forget", "write_failed", error)
                onResult(false)
                return@launch
            }
            handler.post {
                links.remove(accessoryId)?.stop()
                saved.remove(accessoryId)
                groundClearance.forget(accessoryId)
                brakeLight.forget(accessoryId)
                capabilityEnabled.keys.removeAll { it.accessoryId == accessoryId }
                samplingRates.keys.removeAll { it.accessoryId == accessoryId }
                capabilityMutations.keys.filter { it.accessoryId == accessoryId }.forEach {
                    capabilityMutations[it] = (capabilityMutations[it] ?: 0L) + 1
                }
                for (key in lightMutations.keys.filter { it.accessoryId == accessoryId }) {
                    lightMutations[key] = (lightMutations[key] ?: 0L) + 1
                }
                for (key in calibrationSeq.keys.filter { it.accessoryId == accessoryId }) {
                    calibrationSeq[key] = (calibrationSeq[key] ?: 0L) + 1
                }
                publish()
                onResult(removed)
            }
        }
    }

    fun snapshot(): List<Map<String, Any?>> = published

    private fun buildSnapshot(): List<Map<String, Any?>> = saved.values.map { row ->
        val link = links[row.accessoryId]
        val live = link?.manifest
        mapOf(
            "accessoryId" to row.accessoryId,
            "name" to (live?.name ?: row.name),
            "firmwareVersion" to (live?.firmwareVersion ?: row.firmwareVersion),
            "protocolVersion" to (live?.protocolVersion ?: row.protocolVersion),
            "deviceId" to row.deviceId,
            "enrolledAt" to row.enrolledAt,
            "lastConnectedAt" to row.lastConnectedAt,
            "phase" to (link?.phase ?: AccessoryLinkPhase.IDLE).wire,
            "error" to link?.lastError,
            "compatibility" to live?.compatibility?.wire,
            "capabilities" to (live?.capabilities?.map { it.toMap() } ?: decodeCapabilities(row.capabilitiesJson))
                .map { describeCapability(row.accessoryId, it) },
            "capabilitiesChanged" to (
                live != null && encodeCapabilityList(live.capabilities) != row.capabilitiesJson
                ),
            "leaseHeldMs" to link?.lastAckAtMs?.let { SystemClock.elapsedRealtime() - it },
        )
    }

    // @parity /modules/vescape-core/src/index.ts `AccessoryCapability`
    private fun describeCapability(accessoryId: String, capability: Map<String, Any?>): Map<String, Any?> {
        val capabilityId = capability["id"] as? String ?: return capability
        val base = capability + mapOf(
            "enabled" to isCapabilityEnabled(accessoryId, capabilityId),
            "samplingRateHz" to links[accessoryId]?.appliedRateHz(capabilityId),
            "selectedRateHz" to capabilityFromMap(capability)?.let {
                AccessorySession.resolveRateHz(samplingRates[GroundClearanceBindingController.Key(accessoryId, capabilityId)] ?: PREFERRED_RATE_HZ, it.ratesHz)
            },
        )
        if (capability["type"] == AccessoryProtocol.TYPE_BRAKE_LIGHT) return base + brakeLight.describe(BrakeLightController.Key(accessoryId, capabilityId))
        return base + (groundClearance.describe(accessoryId, capabilityId) ?: emptyMap())
    }

    private fun isCapabilityEnabled(accessoryId: String, capabilityId: String): Boolean =
        capabilityEnabled[GroundClearanceBindingController.Key(accessoryId, capabilityId)] != false

    // @parity /modules/vescape-core/ios/accessory/AccessorySessionController.swift `setCapabilityEnabled`
    // @parity /modules/vescape-core/src/index.ts `setAccessoryCapabilityEnabled`
    fun setCapabilityEnabled(accessoryId: String, capabilityId: String, enabled: Boolean, onResult: (Boolean) -> Unit) {
        updateCapabilitySettings(accessoryId, capabilityId, enabled, null, onResult)
    }

    // @parity /modules/vescape-core/ios/accessory/AccessorySessionController.swift `setSamplingRate`
    // @parity /modules/vescape-core/src/index.ts `setAccessorySamplingRate`
    fun setSamplingRate(accessoryId: String, capabilityId: String, rateHz: Double, onResult: (Boolean) -> Unit) {
        updateCapabilitySettings(accessoryId, capabilityId, null, rateHz, onResult)
    }

    private fun updateCapabilitySettings(accessoryId: String, capabilityId: String, enabled: Boolean?, rateHz: Double?, onResult: (Boolean) -> Unit) {
        handler.post {
            val app = appContext ?: return@post onResult(false)
            val row = saved[accessoryId] ?: return@post onResult(false)
            val capabilities = links[accessoryId]?.manifest?.capabilities
                ?: decodeCapabilities(row.capabilitiesJson).mapNotNull(::capabilityFromMap)
            val capability = capabilities.firstOrNull { it.id == capabilityId && it.supported } ?: return@post onResult(false)
            if (rateHz != null && (capability.type != AccessoryProtocol.TYPE_GROUND_CLEARANCE || !rateHz.isFinite() || rateHz !in capability.ratesHz)) return@post onResult(false)
            val key = GroundClearanceBindingController.Key(accessoryId, capabilityId)
            val mutation = (capabilityMutations[key] ?: 0L) + 1
            capabilityMutations[key] = mutation
            calibrationScope.launch {
                val candidate = try {
                    val store = persistence(app)
                    val previous = store.getCapabilitySettings().firstOrNull { it.accessoryId == accessoryId && it.capabilityId == capabilityId }
                    AccessoryCapabilitySettingsEntity(accessoryId, capabilityId, enabled ?: previous?.enabled ?: true, rateHz ?: previous?.samplingRateHz)
                        .also { store.saveCapabilitySettings(it) }
                } catch (error: Throwable) {
                    RecordingStorageFailure.report("accessory_capability_settings", "write_failed", error)
                    handler.post { onResult(false) }
                    return@launch
                }
                handler.post {
                    if (saved.containsKey(accessoryId) && capabilityMutations[key] == mutation) {
                        capabilityEnabled[key] = candidate.enabled
                        candidate.samplingRateHz?.let { samplingRates[key] = it }
                        if (!candidate.enabled) brakeLight.preview(BrakeLightController.Key(accessoryId, capabilityId), null)
                        reapplyDemand()
                        publish()
                    }
                    onResult(true)
                }
            }
        }
    }

    private fun publish() {
        val snapshot = buildSnapshot()
        published = snapshot
        emit?.invoke("onAccessoryState", mapOf("accessories" to snapshot))
    }

    private fun persistence(context: Context) =
        AccessoryPersistence(VescapeDatabase.get(context).vescapeDao())

    private fun link(row: SavedAccessoryEntity): AccessoryLink =
        links.getOrPut(row.accessoryId) {
            AccessoryLink(
                context = requireNotNull(appContext) { "AccessorySessionManager used before start" },
                handler = handler,
                accessoryId = row.accessoryId,
                onChanged = { publish() },
                onManifest = { manifest, deviceId -> onManifestValidated(manifest, deviceId) },
                onReading = { reading, at -> onReading(row.accessoryId, reading, at) },
                onSessionLost = { onSessionLost(row.accessoryId) },
            ).also { it.applyDemand(row) }
        }

    private fun onManifestValidated(manifest: AccessoryManifest, deviceId: String) {
        val previous = saved[manifest.accessoryId] ?: return
        val row = previous.copy(
            name = manifest.name,
            firmwareVersion = manifest.firmwareVersion,
            protocolVersion = manifest.protocolVersion,
            deviceId = deviceId,
            lastConnectedAt = System.currentTimeMillis(),
        )
        saved[manifest.accessoryId] = row
        links[manifest.accessoryId]?.applyDemand(row, manifest)
        val app = appContext ?: return
        scope.launch {
            try {
                persistence(app).revalidate(row)
            } catch (error: Throwable) {
                RecordingStorageFailure.report("accessory_revalidate", "write_failed", error)
            }
        }
    }

    private fun AccessoryLink.applyDemand(
        row: SavedAccessoryEntity,
        manifest: AccessoryManifest? = null,
    ) {
        val capabilities = manifest?.capabilities
            ?: decodeCapabilities(row.capabilitiesJson).mapNotNull(::capabilityFromMap)
        for (capability in capabilities) {
            if (!capability.supported) continue
            when (capability.type) {
                AccessoryProtocol.TYPE_GROUND_CLEARANCE -> {
                    val rate = AccessorySession.resolveRateHz(samplingRates[GroundClearanceBindingController.Key(row.accessoryId, capability.id)] ?: PREFERRED_RATE_HZ, capability.ratesHz)
                        ?: continue
                    setDesired(groundClearance.applyCapability(row.accessoryId, capability, manifest != null, rate, isCapabilityEnabled(row.accessoryId, capability.id)))
                }

                AccessoryProtocol.TYPE_BRAKE_LIGHT -> setDesired(
                    brakeLight.command(BrakeLightController.Key(row.accessoryId, capability.id), isCapabilityEnabled(row.accessoryId, capability.id))
                )

                else -> Unit
            }
        }
    }

    private fun reapplyDemand() {
        for ((accessoryId, link) in links) {
            val row = saved[accessoryId] ?: continue
            link.applyDemand(row, link.manifest)
        }
    }

    fun setLightTelemetry(speedKmh: Double, riding: Boolean, receivedAt: Long = SystemClock.elapsedRealtime()) {
        handler.post {
            if (SystemClock.elapsedRealtime() - receivedAt >= 1500) return@post
            val changed = brakeLight.sample(speedKmh, riding, receivedAt)
            handler.removeCallbacks(lightExpiry)
            handler.postDelayed(lightExpiry, 1500 - (SystemClock.elapsedRealtime() - receivedAt))
            reapplyDemand()
            if (changed) publish()
        }
    }

    fun clearLightTelemetry() {
        handler.post {
            handler.removeCallbacks(lightExpiry)
            brakeLight.clear()
            reapplyDemand()
            publish()
        }
    }

    fun setLightPreview(accessoryId: String, capabilityId: String, mode: String?, onResult: (Boolean) -> Unit) {
        handler.post {
            if (mode != null && !isCapabilityEnabled(accessoryId, capabilityId)) return@post onResult(false)
            val accepted = brakeLight.preview(BrakeLightController.Key(accessoryId, capabilityId), mode)
            if (accepted) { reapplyDemand(); publish() }
            onResult(accepted)
        }
    }

    fun saveBrakeLight(accessoryId: String, capabilityId: String, sensitivity: Int, parked: String, onResult: (Boolean) -> Unit) {
        handler.post {
            val app = appContext ?: return@post onResult(false)
            val candidate = BrakeLightSettings(sensitivity, parked)
            val capabilities = links[accessoryId]?.manifest?.capabilities
                ?: saved[accessoryId]?.let { decodeCapabilities(it.capabilitiesJson).mapNotNull(::capabilityFromMap) }
            if (!candidate.valid() || capabilities?.any { it.id == capabilityId && it.type == AccessoryProtocol.TYPE_BRAKE_LIGHT && it.supported } != true) return@post onResult(false)
            val key = BrakeLightController.Key(accessoryId, capabilityId)
            val mutation = (lightMutations[key] ?: 0L) + 1
            lightMutations[key] = mutation
            calibrationScope.launch {
              lightSaveMutex.withLock {
                try {
                    persistence(app).saveBrakeLight(AccessoryBrakeLightEntity(accessoryId, capabilityId, sensitivity, parked))
                } catch (error: Throwable) {
                    RecordingStorageFailure.report("accessory_brake_light", "write_failed", error)
                    handler.post { onResult(false) }; return@withLock
                }
                handler.post {
                    if (saved.containsKey(accessoryId) && lightMutations[key] == mutation) {
                        brakeLight.configure(BrakeLightController.Key(accessoryId, capabilityId), candidate)
                        reapplyDemand(); publish()
                    }
                    onResult(true)
                }
              }
            }
        }
    }

    fun setPreview(accessoryId: String, capabilityId: String, open: Boolean) {
        handler.post {
            if (!groundClearance.setPreview(accessoryId, capabilityId, open)) return@post
            reapplyDemand()
            publish()
        }
    }

    /**
     * @parity /modules/vescape-core/ios/accessory/AccessorySessionController.swift `releasePreviews`
     */
    fun releasePreviews() {
        handler.post {
            groundClearance.releasePreviews()
            brakeLight.releasePreviews()
            reapplyDemand()
            publish()
        }
    }

    /**
     * @parity /modules/vescape-core/ios/accessory/AccessorySessionController.swift `setRiding`
     */
    fun setRiding(riding: Boolean) {
        if (!groundClearance.setRiding(riding)) return
        handler.post {
            reapplyDemand()
            publish()
        }
    }

    fun saveGroundClearance(
        accessoryId: String,
        capabilityId: String,
        nearCm: Double,
        farCm: Double,
        direction: String,
        strengthPercent: Int,
        onResult: (Map<String, Any?>) -> Unit,
    ) {
        handler.post {
            val app = appContext
            if (app == null || saved[accessoryId] == null) {
                onResult(mapOf("saved" to false, "problem" to "unknown-capability"))
                return@post
            }
            val candidate = GroundClearanceCalibration(nearCm, farCm, direction, strengthPercent)
            val problem = groundClearance.validate(accessoryId, capabilityId, candidate)
            if (problem != null) {
                onResult(mapOf("saved" to false, "problem" to problem.wire))
                return@post
            }
            val liveCapabilities = links[accessoryId]?.manifest?.capabilities
            val key = GroundClearanceBindingController.Key(accessoryId, capabilityId)
            val mutation = (calibrationSeq[key] ?: 0L) + 1
            calibrationSeq[key] = mutation
            val row = AccessoryGroundClearanceEntity(
                accessoryId = accessoryId,
                capabilityId = capabilityId,
                nearCm = nearCm,
                farCm = farCm,
                direction = direction,
                strengthPercent = strengthPercent,
                updatedAt = System.currentTimeMillis(),
            )
            calibrationScope.launch {
                val store = persistence(app)
                try {
                    store.saveGroundClearance(row)
                } catch (error: Throwable) {
                    RecordingStorageFailure.report("accessory_ground_clearance", "write_failed", error)
                    handler.post { onResult(mapOf("saved" to false, "problem" to "storage-unavailable")) }
                    return@launch
                }
                val baseline = liveCapabilities?.let { encodeCapabilityList(it) }
                if (baseline != null) {
                    try {
                        store.adoptCapabilities(accessoryId, baseline)
                    } catch (error: Throwable) {
                        RecordingStorageFailure.report("accessory_revalidate", "write_failed", error)
                    }
                }
                handler.post {
                    if (calibrationSeq[key] != mutation) {
                        onResult(mapOf("saved" to true, "problem" to null))
                        return@post
                    }
                    groundClearance.applyCalibration(accessoryId, capabilityId, candidate)
                    if (baseline != null) {
                        saved[accessoryId]?.let { saved[accessoryId] = it.copy(capabilitiesJson = baseline) }
                    }
                    reapplyDemand()
                    publish()
                    onResult(mapOf("saved" to true, "problem" to null))
                }
            }
        }
    }

    fun clearGroundClearance(accessoryId: String, capabilityId: String, onResult: (Boolean) -> Unit) {
        handler.post {
            val app = appContext ?: return@post onResult(false)
            val key = GroundClearanceBindingController.Key(accessoryId, capabilityId)
            val mutation = (calibrationSeq[key] ?: 0L) + 1
            calibrationSeq[key] = mutation
            calibrationScope.launch {
                val removed = try {
                    persistence(app).clearGroundClearance(accessoryId, capabilityId)
                } catch (error: Throwable) {
                    RecordingStorageFailure.report("accessory_ground_clearance", "write_failed", error)
                    handler.post { onResult(false) }
                    return@launch
                }
                handler.post {
                    if (calibrationSeq[key] != mutation) return@post onResult(removed)
                    groundClearance.clearCalibration(accessoryId, capabilityId)
                    reapplyDemand()
                    publish()
                    onResult(removed)
                }
            }
        }
    }

    /**
     * @parity /modules/vescape-core/ios/accessory/AccessorySessionController.swift `groundClearanceInput`
     */
    fun groundClearanceInput(accessoryId: String, capabilityId: String): GroundClearanceInput {
        return groundClearance.input(accessoryId, capabilityId, linkState(accessoryId, capabilityId))
    }

    /**
     * @parity /modules/vescape-core/ios/accessory/AccessorySessionController.swift `groundClearanceBound`
     */
    fun groundClearanceBound(): Boolean = groundClearance.bound(::linkState)

    /**
     * @parity /modules/vescape-core/ios/accessory/AccessorySessionController.swift `groundClearanceTilt`
     */
    fun groundClearanceTilt(): GroundClearanceInput {
        return groundClearance.tilt(::linkState)
    }

    private fun linkState(accessoryId: String, capabilityId: String): GroundClearanceBindingController.LinkState {
        val link = links[accessoryId]
        return GroundClearanceBindingController.LinkState(
            connected = link?.phase == AccessoryLinkPhase.CONNECTED,
            appliedRateHz = link?.appliedRateHz(capabilityId) ?: 0.0,
        )
    }

    private fun onReading(accessoryId: String, reading: AccessoryReading, receivedAtMs: Long) {
        val payload = groundClearance.acceptReading(
            accessoryId,
            reading,
            receivedAtMs,
            links[accessoryId]?.appliedRateHz(reading.capabilityId),
        ) ?: return
        emit?.invoke("onAccessoryReading", payload)
    }

    private fun onSessionLost(accessoryId: String) {
        groundClearance.onSessionLost(accessoryId)
    }

    private fun AccessoryGroundClearanceEntity.toCalibration() =
        GroundClearanceCalibration(nearCm, farCm, direction, strengthPercent)

    private const val PREFERRED_RATE_HZ = 10.0

    /**
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
