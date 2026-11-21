package expo.modules.vescapecore.accessory

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.util.UUID

/**
 * @parity /modules/vescape-core/ios/accessory/AccessoryProtocol.swift
 * @parity /modules/vescape-core/src/index.ts `AccessoryManifest`
 */
object AccessoryProtocol {
    val SERVICE_UUID: UUID = UUID.fromString("8d53dc10-1db7-4cd3-868b-8a527460aa84")

    val WRITE_UUID: UUID = UUID.fromString("8d53dc11-1db7-4cd3-868b-8a527460aa84")

    val NOTIFY_UUID: UUID = UUID.fromString("8d53dc12-1db7-4cd3-868b-8a527460aa84")

    const val MAX_LINE_BYTES = 4096

    val SUPPORTED_VERSIONS: List<Int> = listOf(1)

    const val HELLO_REQUEST_ID = 1

    const val HANDSHAKE_TIMEOUT_MS = 3_000L

    /**
     * @parity /modules/vescape-core/src/index.ts `AccessoryCapabilityType`
     */
    const val TYPE_GROUND_CLEARANCE = "ground_clearance"
    const val TYPE_BRAKE_LIGHT = "brake_light"

    const val GROUND_CLEARANCE_UNIT = "cm"

    fun encodeHello(sessionId: String): String =
        "{\"type\":\"hello\",\"requestId\":$HELLO_REQUEST_ID,\"sessionId\":${quote(sessionId)}," +
            "\"supportedVersions\":[${SUPPORTED_VERSIONS.joinToString(",")}]}"

    private fun quote(value: String): String = JSONObject.quote(value)

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

        if ((root.opt("sessionId") as? String) != sessionId || wholeNumber(root.opt("requestId")) != requestId) {
            return ManifestResult.Failed(AccessoryHandshakeError.SESSION_MISMATCH)
        }
        if ((root.opt("type") as? String) != "manifest") {
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
            wholeNumber(root.opt("protocolVersion"))
                ?: return ManifestResult.Failed(AccessoryHandshakeError.INVALID)
        }
        val versionAgreed = protocolVersion != null && SUPPORTED_VERSIONS.contains(protocolVersion)

        val supportedVersions = when (val offered = root.opt("supportedVersions")) {
            null, JSONObject.NULL -> emptyList()
            is JSONArray -> (0 until offered.length()).map {
                wholeNumber(offered.opt(it))
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

    private fun parseCapability(entry: JSONObject, versionAgreed: Boolean): AccessoryCapability? {
        val id = requiredString(entry, "id") ?: return null
        val type = requiredString(entry, "type") ?: return null
        val unit = (entry.opt("unit") as? String)?.takeIf { it.isNotEmpty() }
        val range = when (val raw = entry.opt("range")) {
            null, JSONObject.NULL -> null
            is JSONObject -> raw
            else -> return null
        }
        val rangeMin = (range?.opt("min") as? Number)?.toDouble()
        val rangeMax = (range?.opt("max") as? Number)?.toDouble()
        val ratesRaw = when (val raw = entry.opt("ratesHz")) {
            null, JSONObject.NULL -> null
            is JSONArray -> raw
            else -> return null
        }
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
            supported = versionAgreed && typeUsable(type, unit, rangeMin, rangeMax, ratesHz),
            unit = unit,
            rangeMin = rangeMin,
            rangeMax = rangeMax,
            ratesHz = ratesHz,
        )
    }

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

    private fun wholeNumber(value: Any?): Int? {
        val number = value as? Number ?: return null
        val asDouble = number.toDouble()
        if (!asDouble.isFinite() || asDouble != Math.floor(asDouble)) return null
        if (asDouble < Int.MIN_VALUE.toDouble() || asDouble > Int.MAX_VALUE.toDouble()) return null
        return asDouble.toInt()
    }

    private fun requiredString(json: JSONObject, key: String): String? {
        if (json.isNull(key)) return null
        val value = json.opt(key) as? String ?: return null
        return value.takeIf { it.isNotBlank() }
    }
}

/**
 * @parity /modules/vescape-core/ios/accessory/AccessoryProtocol.swift `AccessoryHandshakeError`
 * @parity /modules/vescape-core/src/index.ts `AccessoryInspectionError`
 */
enum class AccessoryHandshakeError(val wire: String) {
    MALFORMED("malformed"),
    INVALID("invalid"),
    SESSION_MISMATCH("session-mismatch"),
}

/**
 * @parity /modules/vescape-core/ios/accessory/AccessoryProtocol.swift `AccessoryCompatibility`
 * @parity /modules/vescape-core/src/index.ts `AccessoryCompatibility`
 */
enum class AccessoryCompatibility(val wire: String) {
    SUPPORTED("supported"),
    UNSUPPORTED_VERSION("unsupported-version"),
    UNSUPPORTED_CAPABILITIES("unsupported-capabilities"),
}

/**
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
 * @parity /modules/vescape-core/ios/accessory/AccessoryProtocol.swift `AccessoryManifest`
 * @parity /modules/vescape-core/src/index.ts `AccessoryManifest`
 */
data class AccessoryManifest(
    val accessoryId: String,
    val name: String,
    val firmwareVersion: String,
    val protocolVersion: Int?,
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
