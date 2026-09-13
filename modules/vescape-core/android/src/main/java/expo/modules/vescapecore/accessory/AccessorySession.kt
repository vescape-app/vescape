package expo.modules.vescapecore.accessory

import org.json.JSONObject
import org.json.JSONTokener

/**
 * Vescape Accessory Protocol v1 — the operational half: the commands an enrolled Accessory's
 * session sends, and the acknowledgements it accepts back.
 *
 * Pure and transport-free on purpose. [AccessoryLink] owns the radio and the clock; everything
 * here is bytes in, bytes out, so the request-id discipline and the encodings can be asserted
 * against `shared/fixtures/accessory-protocol/session.json` without a peripheral in the room.
 *
 * Two rules this file exists to keep:
 *
 * - **Commands set desired values.** Nothing toggles or cycles, so resending the same command is
 *   always safe and a dropped ack costs a retry rather than a restarted animation.
 * - **Request ids are strictly increasing within a session, and never reused with a different
 *   body.** A new protocol session restarts them, which is what makes an old queue harmless.
 *
 * @parity /modules/vescape-core/ios/accessory/AccessorySession.swift
 * @parity /modules/vescape-core/src/index.ts `AccessoryCapabilitySettings`
 */
object AccessorySession {
    /** How long an accessory holds a command before falling back to its local behavior. */
    const val LEASE_MS = 2_000L

    /** How often the app re-sends the current desired command to hold the lease open. */
    const val RENEW_INTERVAL_MS = 500L

    /**
     * How long one request waits for its ack. The first timeout retries with the *same* id — a
     * retry must not look like a new command — and the second gives up on the accessory.
     */
    const val REQUEST_TIMEOUT_MS = 500L

    /** The handshake owns request id 1, so operational requests start after it. */
    const val FIRST_COMMAND_REQUEST_ID = AccessoryProtocol.HELLO_REQUEST_ID + 1

    /**
     * Nearest supported rate, lower on a tie.
     *
     * The accessory resolves this too and answers with what it actually applied; the app resolves
     * it first only so the request it sends is one the hardware can accept. An empty rate list
     * means the capability declared none, and a capability with no rate is not configurable.
     */
    fun resolveRateHz(requested: Double, ratesHz: List<Double>): Double? {
        val usable = ratesHz.filter { it.isFinite() && it > 0.0 }
        if (usable.isEmpty()) return null
        // `<` and not `<=`: equal distance keeps the earlier-sorted, i.e. lower, rate.
        return usable.sorted().reduce { best, candidate ->
            if (Math.abs(candidate - requested) < Math.abs(best - requested)) candidate else best
        }
    }
}

/**
 * One desired capability state. Complete by construction: every field the accessory needs is
 * carried on every send, so a renewal is a replay and never a partial update.
 *
 * @parity /modules/vescape-core/ios/accessory/AccessorySession.swift `AccessoryCommand`
 * @parity /modules/vescape-core/src/index.ts `AccessoryCommandSnapshot`
 */
sealed class AccessoryCommand {
    abstract val capabilityId: String

    /** Measurement demand for a `ground_clearance` capability. */
    data class Configure(
        override val capabilityId: String,
        val enabled: Boolean,
        val rateHz: Double,
    ) : AccessoryCommand()

    /** Semantic output state for a `brake_light` capability. */
    data class State(
        override val capabilityId: String,
        /** `available` or `unavailable` — whether Board telemetry is reaching the app at all. */
        val telemetry: String,
        /** Null when telemetry is unavailable outside preview; the accessory then owns the look. */
        val mode: String?,
        val parked: String,
        val preview: Boolean = false,
    ) : AccessoryCommand()

    /**
     * The exact line to write, at [requestId], inside [sessionId].
     *
     * Built by hand rather than through [JSONObject] for the same reason `encodeHello` is: the
     * shared fixture compares bytes, and a map-backed encoder does not promise key order.
     */
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
            // Omitted when false: the protocol's default, and an omitted field keeps older
            // accessories reading exactly the state they read before preview existed.
            if (preview) append(",\"preview\":true")
            append("}")
        }
    }
}

private fun quote(value: String): String = JSONObject.quote(value)

/** Whole rates print without a decimal point, matching every other encoder on this link. */
private fun number(value: Double): String =
    if (value.isFinite() && value == Math.floor(value) && Math.abs(value) < 1e15) {
        value.toLong().toString()
    } else {
        value.toString()
    }

/**
 * What one received line means to a live session.
 *
 * [Ignored] is deliberately distinct from [Malformed]: a line for another session, or of a type
 * this slice does not handle, is ordinary traffic on a shared characteristic. Only something the
 * framer or the JSON parser could not make sense of ends the session.
 *
 * @parity /modules/vescape-core/ios/accessory/AccessorySession.swift `AccessoryResponse`
 */
sealed class AccessoryResponse {
    /**
     * A command was validated and applied, and the accessory will hold it for [leaseMs].
     *
     * [applied] is flattened to strings: the app compares what was applied against what it asked
     * for, and a textual comparison is the same on both platforms where `1` and `true` are not.
     */
    data class Ack(
        val requestId: Int,
        val capabilityId: String,
        val leaseMs: Long,
        val applied: Map<String, String>,
    ) : AccessoryResponse()

    /** The accessory refused a request. Nothing partial was applied. */
    data class Failed(val requestId: Int?, val code: String) : AccessoryResponse()

    object Ignored : AccessoryResponse()

    object Malformed : AccessoryResponse()

    companion object {
        /**
         * Decodes one received line against [sessionId].
         *
         * Session identity is checked first and an ack missing its lease is refused: without a
         * lease the app has no idea how long the accessory will hold what it just applied, and
         * guessing one is how a light ends up dark with the app believing otherwise.
         */
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

                else -> Ignored
            }
        }

        /** One applied value as text, printing whole numbers without a decimal point. */
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
