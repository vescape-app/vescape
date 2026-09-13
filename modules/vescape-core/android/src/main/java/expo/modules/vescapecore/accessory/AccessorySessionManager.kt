package expo.modules.vescapecore.accessory

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import expo.modules.vescapecore.recording.RecordingStorageFailure
import expo.modules.vescapecore.service.CoreForegroundService
import expo.modules.vescapecore.telemetry.AccessoryGroundClearanceEntity
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

    /**
     * Calibration writes, one at a time and in the order the rider asked for them.
     *
     * The general [scope] fans out across the IO pool, which is right for independent work and wrong
     * for this: a save dispatched before a clear can finish after it and put the row back, and two
     * saves in quick succession can land out of order and leave the older draft on disk. Both are
     * reachable from one screen — the editor saves on a debounce and clears on a tap.
     *
     * @parity /modules/vescape-core/ios/accessory/AccessorySessionController.swift `saveGroundClearance`
     * @platform-diff iOS writes these on the main queue inside `onMain`, which already orders them.
     */
    private val calibrationScope =
        CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(1))

    /**
     * How many calibration mutations have been *asked for* per capability.
     *
     * Ordering the writes is not enough on its own: the in-memory runtime and the published snapshot
     * are updated after the write, back on the main looper, and an older completion arriving there
     * would undo a newer one. Each mutation carries the number it was given and applies nothing if a
     * later one has since been asked for.
     */
    private val calibrationSeq = HashMap<CapabilityKey, Long>()

    private val links = LinkedHashMap<String, AccessoryLink>()
    private val saved = LinkedHashMap<String, SavedAccessoryEntity>()

    /**
     * Live ground-clearance state, one per enrolled capability.
     *
     * Keyed on the Accessory *and* the capability, exactly as the durable row is: one unit may
     * declare a nose sensor and a tail sensor, and they share neither a calibration nor a stream.
     */
    private val clearance = LinkedHashMap<CapabilityKey, GroundClearanceRuntime>()

    /**
     * Whether the Board is carrying a rider, as the Board Session last saw it.
     *
     * One flag for every Accessory: v1 binds to whichever Board is connected, so there is exactly
     * one riding state in the app and no per-Accessory version of it to disagree with.
     *
     * Volatile because the Board Session writes it from its telemetry thread while the main looper
     * reads it to decide demand.
     */
    @Volatile private var riding = false

    private data class CapabilityKey(val accessoryId: String, val capabilityId: String)

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
            val store = persistence(app)
            val rows = try {
                store.getAccessories()
            } catch (error: Throwable) {
                // Nothing starts, and the outage is reported rather than looking like "no
                // Accessories" — a rider whose database is unreadable has not lost their hardware.
                RecordingStorageFailure.reportRead("accessory_list", error)
                return@launch
            }
            val calibrations = try {
                store.getGroundClearances()
            } catch (error: Throwable) {
                // The Accessories still connect. A calibration that could not be read is reported
                // and treated as absent, which shows the rider "not set up" rather than driving the
                // board from numbers this process never actually saw.
                RecordingStorageFailure.reportRead("accessory_ground_clearance", error)
                emptyList()
            }
            handler.post {
                saved.clear()
                rows.forEach { saved[it.accessoryId] = it }
                clearance.clear()
                calibrations.forEach { row ->
                    runtime(row.accessoryId, row.capabilityId).calibration = row.toCalibration()
                }
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
                // The calibrations went with the row in the same transaction; the live runtimes go
                // with them, so a re-enrollment starts from "not set up" rather than from whatever
                // this process still happened to be holding.
                clearance.keys.removeAll { it.accessoryId == accessoryId }
                // A save still in flight for this Accessory must not land on the runtime after the
                // rider forgot it. Bumping the counter is what makes its completion a no-op.
                for (key in calibrationSeq.keys.filter { it.accessoryId == accessoryId }) {
                    calibrationSeq[key] = (calibrationSeq[key] ?: 0L) + 1
                }
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
            "capabilities" to (live?.capabilities?.map { it.toMap() } ?: decodeCapabilities(row.capabilitiesJson))
                .map { describeCapability(row.accessoryId, it) },
            // Derived from the frozen baseline rather than remembered in memory: a flag held only
            // for the life of the process would clear itself on the next launch, which is the one
            // moment the rider is least likely to be looking.
            "capabilitiesChanged" to (
                live != null && encodeCapabilityList(live.capabilities) != row.capabilitiesJson
                ),
            "leaseHeldMs" to link?.lastAckAtMs?.let { SystemClock.elapsedRealtime() - it },
        )
    }

    /**
     * One capability as JS sees it, with whatever this app has saved and decided about it.
     *
     * The saved calibration rides along with the capability rather than in a list of its own: it is
     * keyed on the capability and meaningless without it, and a screen that had to join two arrays
     * by id would be a place for them to disagree.
     *
     * `measuring` is the demand native actually resolved, not a restatement of what the screen
     * asked for — a preview on a capability with no usable rate is a screen that is open and a
     * sensor that is not measuring, and the row should say so.
     */
    private fun describeCapability(accessoryId: String, capability: Map<String, Any?>): Map<String, Any?> {
        val capabilityId = capability["id"] as? String ?: return capability
        val state = clearance[CapabilityKey(accessoryId, capabilityId)] ?: return capability
        val saved = state.calibration
        return capability + mapOf(
            "calibration" to saved?.let {
                mapOf(
                    "nearCm" to it.nearCm,
                    "farCm" to it.farCm,
                    "direction" to it.direction,
                    "strengthPercent" to it.strengthPercent,
                    // Re-decided against the live manifest on every publish. A firmware that
                    // narrowed its range turns a saved calibration into one that needs redoing, and
                    // the row says which rule it now breaks.
                    "problem" to it.problem(state.rangeMin, state.rangeMax)?.wire,
                )
            },
            "measuring" to state.measurementDemanded,
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
                onReading = { reading, at -> onReading(row.accessoryId, reading, at) },
                onSessionLost = { onSessionLost(row.accessoryId) },
            ).also { it.applyDemand(row) }
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
        links[manifest.accessoryId]?.applyDemand(row, manifest)
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
     * What every capability of one Accessory should currently be doing.
     *
     * The whole demand decision lives here and nowhere else. A ground-clearance capability measures
     * when someone actually needs the numbers — the rider has its screen open, or the rider is on a
     * calibrated board — and sits in the protocol's own measurement standby otherwise. Standby is
     * not a pause in the app: `enabled: false` stops the sensor's continuous measurement on the
     * accessory while BLE stays up, so leaving the screen genuinely stops measuring rather than
     * throwing away samples the hardware is still burning power to produce.
     *
     * The brake light still gets #480's neutral baseline. It is the protocol's own unavailable
     * state, and the slice that owns that capability replaces it with real telemetry.
     */
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
                    val rate = AccessorySession.resolveRateHz(PREFERRED_RATE_HZ, capability.ratesHz)
                        ?: continue
                    val state = runtime(row.accessoryId, capability.id)
                    // Only a live manifest carries limits worth trusting. The decoded baseline is
                    // what the Accessory said at enrollment, which is exactly the thing a changed
                    // firmware invalidates — so the runtime keeps whatever the last handshake set
                    // rather than being reset to a stale window by an offline re-apply.
                    if (manifest != null) {
                        state.rangeMin = capability.rangeMin
                        state.rangeMax = capability.rangeMax
                    }
                    state.riding = riding
                    setDesired(
                        AccessoryCommand.Configure(
                            capabilityId = capability.id,
                            enabled = state.measurementDemanded,
                            rateHz = rate,
                        ),
                    )
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

    /** Re-decides demand for every enrolled Accessory, from whatever its session currently knows. */
    private fun reapplyDemand() {
        for ((accessoryId, link) in links) {
            val row = saved[accessoryId] ?: continue
            link.applyDemand(row, link.manifest)
        }
    }

    // MARK: - Ground clearance

    private fun runtime(accessoryId: String, capabilityId: String): GroundClearanceRuntime =
        clearance.getOrPut(CapabilityKey(accessoryId, capabilityId)) {
            GroundClearanceRuntime(capabilityId)
        }

    /**
     * The configuration screen for one capability opened or closed.
     *
     * The only demand JS is allowed to express, and it is a request to *measure*, never to tilt: a
     * preview shows numbers on a parked board, and [groundClearanceInput] refuses to drive anything
     * that is not being ridden regardless of what this says.
     *
     * A screen that is gone — backgrounded, unmounted, or its JS runtime killed — stops the sensor,
     * which is what "leaving the screen stops measurements" means at the hardware.
     */
    fun setPreview(accessoryId: String, capabilityId: String, open: Boolean) {
        handler.post {
            val state = runtime(accessoryId, capabilityId)
            if (state.previewOpen == open) return@post
            state.previewOpen = open
            reapplyDemand()
            publish()
        }
    }

    /**
     * Drops every preview, whoever asked for it.
     *
     * Preview demand lives in this process and the screen that asked for it lives in a JS runtime
     * that can disappear without unmounting anything — a reload, a crash, a development refresh. The
     * accessory's own lease cannot save it either, because native keeps renewing the configuration
     * on the screen's behalf. So the runtime going away has to be the release.
     *
     * Riding demand is deliberately untouched: it comes from the Board Session, which outlives JS.
     *
     * @parity /modules/vescape-core/ios/accessory/AccessorySessionController.swift `releasePreviews`
     */
    fun releasePreviews() {
        handler.post {
            var changed = false
            for (state in clearance.values) {
                if (!state.previewOpen) continue
                state.previewOpen = false
                changed = true
            }
            if (!changed) return@post
            reapplyDemand()
            publish()
        }
    }

    /**
     * Board engagement, from the Board Session's own predicate.
     *
     * Native's, never JS's: this decides whether a sensor runs while the screen is off, and a value
     * that arrived over the bridge would stop being true the moment the runtime died.
     *
     * @parity /modules/vescape-core/ios/accessory/AccessorySessionController.swift `setRiding`
     */
    fun setRiding(riding: Boolean) {
        // Compared before the hop, not inside it. This arrives with every telemetry sample for the
        // whole of a ride, and posting a Runnable per sample to discover that nothing changed is a
        // few thousand allocations an hour for no decision.
        if (this.riding == riding) return
        this.riding = riding
        handler.post {
            reapplyDemand()
            publish()
        }
    }

    /**
     * Saves one calibration, if it is one.
     *
     * There is no Save button behind this: the screen sends what the rider has so far and native
     * decides whether it is complete. Validity is judged against the limits the Accessory declares
     * *now*, so a calibration is never written that the hardware in front of the rider would refuse.
     *
     * Saving a calibration that fits the current manifest is also how the rider accepts limits that
     * moved since enrollment: the frozen `capabilities_json` baseline is rewritten to what the
     * session just validated against, which is what clears "this Accessory now declares different
     * limits". Nothing else in the app may rewrite that baseline.
     */
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
            val state = runtime(accessoryId, capabilityId)
            val candidate = GroundClearanceCalibration(nearCm, farCm, direction, strengthPercent)
            val problem = candidate.problem(state.rangeMin, state.rangeMax)
            if (problem != null) {
                onResult(mapOf("saved" to false, "problem" to problem.wire))
                return@post
            }
            val liveCapabilities = links[accessoryId]?.manifest?.capabilities
            val key = CapabilityKey(accessoryId, capabilityId)
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
                    // Nothing is applied in memory either. A binding that drove from a calibration
                    // the database never took would come back uncalibrated on the next launch, with
                    // the rider believing they had set it.
                    RecordingStorageFailure.report("accessory_ground_clearance", "write_failed", error)
                    handler.post { onResult(mapOf("saved" to false, "problem" to "storage-unavailable")) }
                    return@launch
                }
                val baseline = liveCapabilities?.let { encodeCapabilityList(it) }
                if (baseline != null) {
                    try {
                        store.adoptCapabilities(accessoryId, baseline)
                    } catch (error: Throwable) {
                        // The calibration is saved and correct; only the warning outlives the
                        // acceptance, and the next save clears it.
                        RecordingStorageFailure.report("accessory_revalidate", "write_failed", error)
                    }
                }
                handler.post {
                    // The row is written either way — the writes are ordered, so the newest ask is
                    // the one on disk. What is refused here is applying an older ask's *result* over
                    // a newer one in memory, which is how a save that raced a clear used to put the
                    // calibration back.
                    if (calibrationSeq[key] != mutation) {
                        onResult(mapOf("saved" to true, "problem" to null))
                        return@post
                    }
                    state.calibration = candidate
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

    /** Drops a calibration. The binding stops driving and the screen goes back to explaining setup. */
    fun clearGroundClearance(accessoryId: String, capabilityId: String, onResult: (Boolean) -> Unit) {
        handler.post {
            val app = appContext ?: return@post onResult(false)
            val key = CapabilityKey(accessoryId, capabilityId)
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
                    runtime(accessoryId, capabilityId).calibration = null
                    reapplyDemand()
                    publish()
                    onResult(removed)
                }
            }
        }
    }

    /**
     * What a Remote Tilt binding may do with this capability right now. The seam #479 consumes.
     *
     * Two outcomes and no third: a scaled, signed input built from a fresh in-range measurement, or
     * a named reason to release. Nothing here can be read as "hold the last value" — a consumer that
     * gets a release has been told to let go, and why.
     *
     * @parity /modules/vescape-core/ios/accessory/AccessorySessionController.swift `groundClearanceInput`
     */
    fun groundClearanceInput(accessoryId: String, capabilityId: String): GroundClearanceInput {
        val state = clearance[CapabilityKey(accessoryId, capabilityId)]
            ?: return GroundClearanceInput.Release(GroundClearanceRelease.NOT_CALIBRATED)
        val link = links[accessoryId]
        state.rateHz = link?.appliedRateHz(capabilityId) ?: 0.0
        return state.input(
            nowMs = SystemClock.elapsedRealtime(),
            linkConnected = link?.phase == AccessoryLinkPhase.CONNECTED,
        )
    }

    /**
     * Every ground-clearance capability that is set up and answering right now.
     *
     * "Set up and answering" is the whole definition of a bound binding: a saved calibration that
     * still fits the live manifest, on a session that is connected. It says nothing about riding —
     * that is [GroundClearanceRuntime.input]'s question, and keeping the two apart is what lets the
     * pad go read-only the moment the Accessory is there rather than only once the rider sets off.
     *
     * Main looper only, like everything else that touches [clearance] and [links]. The Board
     * Session's tick runs there too.
     */
    private fun boundCapabilities(): List<CapabilityKey> =
        clearance.entries
            .filter { (key, state) ->
                state.isCalibrated && links[key.accessoryId]?.phase == AccessoryLinkPhase.CONNECTED
            }
            .map { it.key }

    /**
     * Whether a configured ground-clearance Accessory is connected.
     *
     * What makes the Remote Tilt pad a read-only indicator. Deliberately true even when the bindings
     * are [GroundClearanceRelease.CONTESTED] and none of them is driving: a rider whose two sensors
     * cancel each other out must not silently get their manual pad back, because the pad is not what
     * this board is configured for.
     *
     * @parity /modules/vescape-core/ios/accessory/AccessorySessionController.swift `groundClearanceBound`
     */
    fun groundClearanceBound(): Boolean = boundCapabilities().isNotEmpty()

    /**
     * The single ground-clearance input a Remote Tilt binding may act on, across every Accessory.
     *
     * v1 binds to whichever Board is connected and has no arbitration between a nose sensor and a
     * tail sensor — the eventual hardware has both. Two claimants therefore release rather than
     * resolve: choosing one of them would be choosing a correction *direction* on the rider's behalf,
     * and the wrong choice tilts the board the wrong way.
     *
     * @parity /modules/vescape-core/ios/accessory/AccessorySessionController.swift `groundClearanceTilt`
     */
    fun groundClearanceTilt(): GroundClearanceInput {
        val bound = boundCapabilities()
        if (bound.size > 1) return GroundClearanceInput.Release(GroundClearanceRelease.CONTESTED)
        val key = bound.firstOrNull()
            ?: return GroundClearanceInput.Release(
                // A calibration with no session behind it is a link problem, not a setup problem,
                // and the two read very differently to someone holding the accessory.
                if (clearance.values.any { it.isCalibrated }) {
                    GroundClearanceRelease.NO_LINK
                } else {
                    GroundClearanceRelease.NOT_CALIBRATED
                },
            )
        return groundClearanceInput(key.accessoryId, key.capabilityId)
    }

    /**
     * One sample off an Accessory's reading stream.
     *
     * Range-checked against the limits the *live* manifest declares before anything else sees it, so
     * a number the hardware no longer promises is carried onward as `out_of_range` with no value
     * rather than as a distance. A sample older than the newest one held is dropped outright.
     *
     * The bridge only hears about it while a screen is open. Nothing else in the app consumes single
     * samples — the tilt binding pulls [groundClearanceInput] on its own cadence — so emitting at
     * the sensor's rate with nothing mounted would be pure bridge traffic.
     */
    private fun onReading(accessoryId: String, reading: AccessoryReading, receivedAtMs: Long) {
        val state = clearance[CapabilityKey(accessoryId, reading.capabilityId)] ?: return
        state.rateHz = links[accessoryId]?.appliedRateHz(reading.capabilityId) ?: state.rateHz
        val checked = reading.withinDeclaredRange(state.rangeMin, state.rangeMax)
        if (!state.tracker.accept(checked, receivedAtMs)) return
        if (!state.previewOpen) return
        emit?.invoke(
            "onAccessoryReading",
            mapOf(
                "accessoryId" to accessoryId,
                "capabilityId" to checked.capabilityId,
                "seq" to checked.seq,
                "sampleTimeMs" to checked.sampleTimeMs,
                "status" to checked.status.wire,
                "valueCm" to checked.valueCm,
                // The window this sample stays evidence for, from the rate the accessory confirmed.
                // Sent with every sample so a screen can stop showing a distance the moment it stops
                // describing the ground, without re-deriving the rule JS does not own.
                "staleAfterMs" to GroundClearance.staleAfterMs(state.rateHz),
            ),
        )
    }

    /**
     * The protocol session for one Accessory ended.
     *
     * Sequence numbers restart with the next hello, so anything the tracker still holds would make
     * the new session's first samples look like duplicates. The calibration is durable and stays.
     */
    private fun onSessionLost(accessoryId: String) {
        for ((key, state) in clearance) {
            if (key.accessoryId == accessoryId) state.onSessionLost()
        }
    }

    private fun AccessoryGroundClearanceEntity.toCalibration() =
        GroundClearanceCalibration(nearCm, farCm, direction, strengthPercent)

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
