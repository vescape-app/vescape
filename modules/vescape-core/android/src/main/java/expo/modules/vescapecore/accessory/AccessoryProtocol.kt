package expo.modules.vescapecore.accessory

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.util.UUID

/**
 * Vescape Accessory Protocol v1 — the discovery half: the custom GATT service that identifies an
 * Accessory regardless of its advertised name, the `hello` the app writes once it has subscribed,
 * and the manifest it reads back.
 *
 * Nothing here commands an Accessory. Discovery reads identity, protocol version and capability
 * types; every operational message (`configure`, `state`, `reading`) belongs to the per-capability
 * slices that follow, so an Accessory found here can never start measuring or lighting up.
 *
 * The wire contract is `docs/accessory-protocol.md`; the executable form of it is
 * `shared/fixtures/accessory-protocol/`, which this file, its Swift peer and the ESP32 firmware all
 * run.
 *
 * @parity /modules/vescape-core/ios/accessory/AccessoryProtocol.swift
 * @parity /modules/vescape-core/src/index.ts `AccessoryManifest`
 */
object AccessoryProtocol {
    /** Advertised service that makes a device a Vescape Accessory. Project-assigned, not SIG. */
    val SERVICE_UUID: UUID = UUID.fromString("8d53dc10-1db7-4cd3-868b-8a527460aa84")

    /** App to accessory, write with response. */
    val WRITE_UUID: UUID = UUID.fromString("8d53dc11-1db7-4cd3-868b-8a527460aa84")

    /** Accessory to app, notify. */
    val NOTIFY_UUID: UUID = UUID.fromString("8d53dc12-1db7-4cd3-868b-8a527460aa84")

    /** Maximum NDJSON line length excluding the LF. Anything longer ends the protocol session. */
    const val MAX_LINE_BYTES = 4096

    /** Protocol versions this app can speak. */
    val SUPPORTED_VERSIONS: List<Int> = listOf(1)

    /** The handshake is the first request of a session, so its id is fixed. */
    const val HELLO_REQUEST_ID = 1

    /** Manifest response timeout, `docs/accessory-protocol.md` PoC defaults. */
    const val HANDSHAKE_TIMEOUT_MS = 3_000L

    /**
     * Capability types v1 recognizes. An accessory may advertise others; they are reported as
     * unsupported rather than hiding the capabilities that do work.
     *
     * @parity /modules/vescape-core/src/index.ts `AccessoryCapabilityType`
     */
    const val TYPE_GROUND_CLEARANCE = "ground_clearance"
    const val TYPE_BRAKE_LIGHT = "brake_light"

    /** Ground clearance is measured in centimetres; any other unit is a capability we cannot use. */
    const val GROUND_CLEARANCE_UNIT = "cm"

    /**
     * The one line discovery writes. Built by hand rather than through [JSONObject] because the
     * shared fixture pins the exact bytes, and a map-backed encoder does not promise key order.
     */
    fun encodeHello(sessionId: String): String =
        "{\"type\":\"hello\",\"requestId\":$HELLO_REQUEST_ID,\"sessionId\":${quote(sessionId)}," +
            "\"supportedVersions\":[${SUPPORTED_VERSIONS.joinToString(",")}]}"

    private fun quote(value: String): String = JSONObject.quote(value)

    /**
     * Decodes one received line as the manifest answering [sessionId]/[requestId].
     *
     * Rejection is deliberately coarse: a manifest that fails any envelope rule is not partially
     * trusted, because saved settings key on the identity it carries.
     */
    fun parseManifest(
        line: String,
        sessionId: String,
        requestId: Int = HELLO_REQUEST_ID,
    ): ManifestResult {
        val root = try {
            JSONTokener(line).nextValue()
        } catch (e: Exception) {
            return ManifestResult.Failed(AccessoryHandshakeError.MALFORMED)
        }
        if (root !is JSONObject) return ManifestResult.Failed(AccessoryHandshakeError.MALFORMED)

        // Session identity is checked before anything else is read: a message from a previous
        // session must not renew or influence this one.
        if (root.optString("sessionId") != sessionId || root.optInt("requestId", -1) != requestId) {
            return ManifestResult.Failed(AccessoryHandshakeError.SESSION_MISMATCH)
        }
        if (root.optString("type") != "manifest") {
            return ManifestResult.Failed(AccessoryHandshakeError.INVALID)
        }
        if (!root.has("protocolVersion")) {
            return ManifestResult.Failed(AccessoryHandshakeError.INVALID)
        }

        val accessoryId = requiredString(root, "accessoryId")
            ?: return ManifestResult.Failed(AccessoryHandshakeError.INVALID)
        val name = requiredString(root, "name")
            ?: return ManifestResult.Failed(AccessoryHandshakeError.INVALID)
        val firmwareVersion = requiredString(root, "firmwareVersion")
            ?: return ManifestResult.Failed(AccessoryHandshakeError.INVALID)

        val protocolVersion = if (root.isNull("protocolVersion")) {
            null
        } else {
            (root.opt("protocolVersion") as? Number)?.toInt()
                ?: return ManifestResult.Failed(AccessoryHandshakeError.INVALID)
        }
        val versionAgreed = protocolVersion != null && SUPPORTED_VERSIONS.contains(protocolVersion)

        val supportedVersions = when (val offered = root.opt("supportedVersions")) {
            null, JSONObject.NULL -> emptyList()
            is JSONArray -> (0 until offered.length()).map {
                (offered.opt(it) as? Number)?.toInt()
                    ?: return ManifestResult.Failed(AccessoryHandshakeError.INVALID)
            }
            else -> return ManifestResult.Failed(AccessoryHandshakeError.INVALID)
        }

        val declared = when (val raw = root.opt("capabilities")) {
            null, JSONObject.NULL -> JSONArray()
            is JSONArray -> raw
            else -> return ManifestResult.Failed(AccessoryHandshakeError.INVALID)
        }
        val capabilities = mutableListOf<AccessoryCapability>()
        val seen = mutableSetOf<String>()
        for (i in 0 until declared.length()) {
            val entry = declared.opt(i) as? JSONObject
                ?: return ManifestResult.Failed(AccessoryHandshakeError.INVALID)
            val capability = parseCapability(entry, versionAgreed)
                ?: return ManifestResult.Failed(AccessoryHandshakeError.INVALID)
            if (!seen.add(capability.id)) {
                return ManifestResult.Failed(AccessoryHandshakeError.INVALID)
            }
            capabilities.add(capability)
        }

        val compatibility = when {
            !versionAgreed -> AccessoryCompatibility.UNSUPPORTED_VERSION
            capabilities.none { it.supported } -> AccessoryCompatibility.UNSUPPORTED_CAPABILITIES
            else -> AccessoryCompatibility.SUPPORTED
        }

        return ManifestResult.Ok(
            AccessoryManifest(
                accessoryId = accessoryId,
                name = name,
                firmwareVersion = firmwareVersion,
                protocolVersion = protocolVersion,
                supportedVersions = supportedVersions,
                compatibility = compatibility,
                capabilities = capabilities,
            ),
        )
    }

    /** Null means the capability breaks an envelope rule and the whole manifest is rejected. */
    private fun parseCapability(entry: JSONObject, versionAgreed: Boolean): AccessoryCapability? {
        val id = requiredString(entry, "id") ?: return null
        val type = requiredString(entry, "type") ?: return null
        val unit = (entry.opt("unit") as? String)?.takeIf { it.isNotEmpty() }
        val range = entry.optJSONObject("range")
        val rangeMin = (range?.opt("min") as? Number)?.toDouble()
        val rangeMax = (range?.opt("max") as? Number)?.toDouble()
        val ratesRaw = entry.optJSONArray("ratesHz")
        val ratesHz = buildList {
            if (ratesRaw != null) {
                for (i in 0 until ratesRaw.length()) {
                    add((ratesRaw.opt(i) as? Number)?.toDouble() ?: return null)
                }
            }
        }
        return AccessoryCapability(
            id = id,
            type = type,
            // A capability is only usable when the session speaks a version both sides agreed on,
            // so a version mismatch grays out every capability rather than some of them.
            supported = versionAgreed && typeUsable(type, unit, rangeMin, rangeMax, ratesHz),
            unit = unit,
            rangeMin = rangeMin,
            rangeMax = rangeMax,
            ratesHz = ratesHz,
        )
    }

    /**
     * Whether a recognized capability type also declares limits this app can work within. A
     * `ground_clearance` in millimetres, with an empty range, or offering no rate is a capability
     * we would have to guess about; a recognized type is not by itself a usable one.
     */
    private fun typeUsable(
        type: String,
        unit: String?,
        rangeMin: Double?,
        rangeMax: Double?,
        ratesHz: List<Double>,
    ): Boolean = when (type) {
        TYPE_BRAKE_LIGHT -> true
        TYPE_GROUND_CLEARANCE -> unit == GROUND_CLEARANCE_UNIT &&
            rangeMin != null && rangeMax != null &&
            rangeMin.isFinite() && rangeMax.isFinite() && rangeMin < rangeMax &&
            ratesHz.isNotEmpty() && ratesHz.all { it.isFinite() && it > 0.0 }
        else -> false
    }

    private fun requiredString(json: JSONObject, key: String): String? {
        if (json.isNull(key)) return null
        val value = json.opt(key) as? String ?: return null
        return value.takeIf { it.isNotBlank() }
    }
}

/**
 * Why a handshake produced no usable Accessory. Mirrors the `errors` list in
 * `shared/fixtures/accessory-protocol/handshake.json`.
 *
 * @parity /modules/vescape-core/ios/accessory/AccessoryProtocol.swift `AccessoryHandshakeError`
 * @parity /modules/vescape-core/src/index.ts `AccessoryInspectionError`
 */
enum class AccessoryHandshakeError(val wire: String) {
    MALFORMED("malformed"),
    INVALID("invalid"),
    SESSION_MISMATCH("session-mismatch"),
}

/**
 * How much of a discovered Accessory this app can actually use.
 *
 * @parity /modules/vescape-core/ios/accessory/AccessoryProtocol.swift `AccessoryCompatibility`
 * @parity /modules/vescape-core/src/index.ts `AccessoryCompatibility`
 */
enum class AccessoryCompatibility(val wire: String) {
    SUPPORTED("supported"),
    UNSUPPORTED_VERSION("unsupported-version"),
    UNSUPPORTED_CAPABILITIES("unsupported-capabilities"),
}

/**
 * One capability an Accessory declares. [type] keeps the raw wire value even when unrecognized, so
 * an unknown capability can be named on screen instead of disappearing.
 *
 * @parity /modules/vescape-core/ios/accessory/AccessoryProtocol.swift `AccessoryCapability`
 * @parity /modules/vescape-core/src/index.ts `AccessoryCapability`
 */
data class AccessoryCapability(
    val id: String,
    val type: String,
    val supported: Boolean,
    val unit: String?,
    val rangeMin: Double?,
    val rangeMax: Double?,
    val ratesHz: List<Double>,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "id" to id,
        "type" to type,
        "supported" to supported,
        "unit" to unit,
        "rangeMin" to rangeMin,
        "rangeMax" to rangeMax,
        "ratesHz" to ratesHz,
    )
}

/**
 * What an Accessory says about itself on every connection. Read again on each reconnect — saved
 * settings are only trusted after the identity, version and capability limits here still match.
 *
 * @parity /modules/vescape-core/ios/accessory/AccessoryProtocol.swift `AccessoryManifest`
 * @parity /modules/vescape-core/src/index.ts `AccessoryManifest`
 */
data class AccessoryManifest(
    /** Factory-provisioned persistent UUID. Saved settings key on this, never on the BLE address. */
    val accessoryId: String,
    val name: String,
    val firmwareVersion: String,
    /** Null when the accessory found no common version; it then accepts no operational commands. */
    val protocolVersion: Int?,
    /** What the accessory offers instead, present only when no version was agreed. */
    val supportedVersions: List<Int>,
    val compatibility: AccessoryCompatibility,
    val capabilities: List<AccessoryCapability>,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "accessoryId" to accessoryId,
        "name" to name,
        "firmwareVersion" to firmwareVersion,
        "protocolVersion" to protocolVersion,
        "supportedVersions" to supportedVersions,
        "compatibility" to compatibility.wire,
        "capabilities" to capabilities.map { it.toMap() },
    )
}

sealed class ManifestResult {
    data class Ok(val manifest: AccessoryManifest) : ManifestResult()
    data class Failed(val error: AccessoryHandshakeError) : ManifestResult()
}
