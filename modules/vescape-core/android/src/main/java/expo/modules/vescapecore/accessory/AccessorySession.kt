package expo.modules.vescapecore.accessory

import org.json.JSONObject
import org.json.JSONTokener

/**
 * @parity /modules/vescape-core/ios/accessory/AccessorySession.swift
 */
object AccessorySession {
    const val LEASE_MS = 2_000L

    const val RENEW_INTERVAL_MS = 500L

    const val REQUEST_TIMEOUT_MS = 500L

    const val FIRST_COMMAND_REQUEST_ID = AccessoryProtocol.HELLO_REQUEST_ID + 1

    fun resolveRateHz(requested: Double, ratesHz: List<Double>): Double? {
        val usable = ratesHz.filter { it.isFinite() && it > 0.0 }
        if (usable.isEmpty()) return null
        return usable.sorted().reduce { best, candidate ->
            if (Math.abs(candidate - requested) < Math.abs(best - requested)) candidate else best
        }
    }
}

/**
 * @parity /modules/vescape-core/ios/accessory/AccessorySession.swift `AccessoryCommand`
 */
sealed class AccessoryCommand {
    abstract val capabilityId: String

    data class Configure(
        override val capabilityId: String,
        val enabled: Boolean,
        val rateHz: Double,
    ) : AccessoryCommand()

    data class State(
        override val capabilityId: String,
        val telemetry: String,
        val mode: String?,
        val parked: String,
        val preview: Boolean = false,
    ) : AccessoryCommand()

    fun encode(sessionId: String, requestId: Int): String = when (this) {
        is Configure ->
            "{\"type\":\"configure\",\"sessionId\":${quote(sessionId)},\"requestId\":$requestId," +
                "\"capabilityId\":${quote(capabilityId)},\"enabled\":$enabled," +
                "\"rateHz\":${number(rateHz)}}"

        is State -> buildString {
            append("{\"type\":\"state\",\"sessionId\":").append(quote(sessionId))
            append(",\"requestId\":").append(requestId)
            append(",\"capabilityId\":").append(quote(capabilityId))
            append(",\"telemetry\":").append(quote(telemetry))
            if (mode != null) append(",\"mode\":").append(quote(mode))
            append(",\"parked\":").append(quote(parked))
            if (preview) append(",\"preview\":true")
            append("}")
        }
    }
}

private fun quote(value: String): String = JSONObject.quote(value)

private fun number(value: Double): String =
    if (value.isFinite() && value == Math.floor(value) && Math.abs(value) < 1e15) {
        value.toLong().toString()
    } else {
        value.toString()
    }

/**
 * @parity /modules/vescape-core/ios/accessory/AccessorySession.swift `AccessoryReadingStatus`
 * @parity /modules/vescape-core/src/index.ts `AccessoryReadingStatus`
 */
enum class AccessoryReadingStatus(val wire: String) {
    OK("ok"),

    OUT_OF_RANGE("out_of_range"),

    ERROR("error");

    companion object {
        fun fromWire(value: String?): AccessoryReadingStatus =
            entries.firstOrNull { it.wire == value } ?: ERROR
    }
}

/**
 * @parity /modules/vescape-core/ios/accessory/AccessorySession.swift `AccessoryReading`
 * @parity /modules/vescape-core/src/index.ts `AccessoryReadingEvent`
 */
data class AccessoryReading(
    val capabilityId: String,
    val seq: Int,
    val sampleTimeMs: Long,
    val status: AccessoryReadingStatus,
    val valueCm: Double?,
) {
    init {
        require(status == AccessoryReadingStatus.OK || valueCm == null) {
            "only an ok reading carries a value"
        }
    }

    fun withinDeclaredRange(rangeMin: Double?, rangeMax: Double?): AccessoryReading {
        val value = valueCm ?: return this
        if (rangeMin == null || rangeMax == null) return this
        if (value < rangeMin || value > rangeMax) {
            return copy(status = AccessoryReadingStatus.OUT_OF_RANGE, valueCm = null)
        }
        return this
    }
}

/**
 * @parity /modules/vescape-core/ios/accessory/AccessorySession.swift `AccessoryResponse`
 */
sealed class AccessoryResponse {
    data class Ack(
        val requestId: Int,
        val capabilityId: String,
        val leaseMs: Long,
        val applied: Map<String, String>,
    ) : AccessoryResponse()

    data class Failed(val requestId: Int?, val code: String) : AccessoryResponse()

    data class Sample(val reading: AccessoryReading) : AccessoryResponse()

    object Ignored : AccessoryResponse()

    object Malformed : AccessoryResponse()

    companion object {
        fun parse(line: String, sessionId: String): AccessoryResponse {
            val root = try {
                JSONTokener(line).nextValue()
            } catch (e: Exception) {
                return Malformed
            }
            if (root !is JSONObject) return Malformed
            if ((root.opt("sessionId") as? String) != sessionId) return Ignored

            return when (root.opt("type") as? String) {
                "ack" -> {
                    val requestId = wholeNumber(root.opt("requestId")) ?: return Ignored
                    val capabilityId = (root.opt("capabilityId") as? String)
                        ?.takeIf { it.isNotBlank() } ?: return Ignored
                    val leaseMs = wholeNumber(root.opt("leaseMs"))?.toLong() ?: return Ignored
                    if (leaseMs <= 0L) return Ignored
                    val applied = (root.opt("applied") as? JSONObject)?.let { json ->
                        buildMap {
                            for (key in json.keys()) {
                                if (json.isNull(key)) continue
                                put(key, describe(json.opt(key)))
                            }
                        }
                    } ?: emptyMap()
                    Ack(requestId, capabilityId, leaseMs, applied)
                }

                "error" -> {
                    val code = (root.opt("code") as? String)?.takeIf { it.isNotBlank() }
                        ?: return Ignored
                    Failed(wholeNumber(root.opt("requestId")), code)
                }

                "reading" -> parseReading(root)

                else -> Ignored
            }
        }

        private fun parseReading(root: JSONObject): AccessoryResponse {
            val capabilityId = (root.opt("capabilityId") as? String)
                ?.takeIf { it.isNotBlank() } ?: return Ignored
            val seq = wholeNumber(root.opt("seq")) ?: return Ignored
            val sampleTimeMs = wholeNumber(root.opt("sampleTimeMs"))?.toLong() ?: return Ignored
            val status = AccessoryReadingStatus.fromWire(root.opt("status") as? String)
            val value = (root.opt("value") as? Number)?.toDouble()?.takeIf { it.isFinite() }
            val resolved = if (status == AccessoryReadingStatus.OK && value == null) {
                AccessoryReadingStatus.ERROR
            } else {
                status
            }
            return Sample(
                AccessoryReading(
                    capabilityId = capabilityId,
                    seq = seq,
                    sampleTimeMs = sampleTimeMs,
                    status = resolved,
                    valueCm = if (resolved == AccessoryReadingStatus.OK) value else null,
                ),
            )
        }

        private fun describe(value: Any?): String = when (value) {
            is Boolean -> if (value) "true" else "false"
            is Number -> {
                val asDouble = value.toDouble()
                if (asDouble.isFinite() && asDouble == Math.floor(asDouble) && Math.abs(asDouble) < 1e15) {
                    asDouble.toLong().toString()
                } else {
                    asDouble.toString()
                }
            }
            else -> value.toString()
        }

        private fun wholeNumber(value: Any?): Int? {
            val number = value as? Number ?: return null
            val asDouble = number.toDouble()
            if (!asDouble.isFinite() || asDouble != Math.floor(asDouble)) return null
            if (asDouble < Int.MIN_VALUE.toDouble() || asDouble > Int.MAX_VALUE.toDouble()) return null
            return asDouble.toInt()
        }
    }
}
