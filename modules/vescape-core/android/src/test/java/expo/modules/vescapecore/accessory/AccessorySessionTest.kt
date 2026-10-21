package expo.modules.vescapecore.accessory

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The operational session contract, driven by `shared/fixtures/accessory-protocol/session.json`:
 * the exact bytes of every command this app writes, and what each accessory line must mean to a
 * live session.
 *
 * @parity /modules/vescape-core/ios/accessory/AccessorySessionTests.swift
 */
class AccessorySessionTest {
    private val fixture = AccessoryFixtures.load("session.json")
    private val sessionId = fixture.getString("sessionId")

    @Test
    fun timingDefaultsMatchTheSharedFixture() {
        val timing = fixture.getJSONObject("timing")
        assertEquals(timing.getLong("leaseMs"), AccessorySession.LEASE_MS)
        assertEquals(timing.getLong("renewIntervalMs"), AccessorySession.RENEW_INTERVAL_MS)
        assertEquals(timing.getLong("requestTimeoutMs"), AccessorySession.REQUEST_TIMEOUT_MS)
        assertEquals(timing.getLong("handshakeTimeoutMs"), AccessoryProtocol.HANDSHAKE_TIMEOUT_MS)
    }

    @Test
    fun theFirstCommandComesAfterTheHandshakeRequestId() {
        // The hello owns request id 1; an operational request that reused it would look to the
        // accessory like a duplicate handshake rather than a new command.
        assertEquals(
            fixture.getInt("helloRequestId") + 1,
            AccessorySession.FIRST_COMMAND_REQUEST_ID,
        )
    }

    @Test
    fun everyCommandIsEncodedByteForByteAsTheFixturePinsIt() {
        val cases = fixture.getJSONArray("encode")
        assertTrue("fixture must carry encode cases", cases.length() > 0)
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            val name = case.getString("name")
            val spec = case.getJSONObject("command")
            val capabilityId = spec.getString("capabilityId")
            val command = when (val kind = spec.getString("kind")) {
                "configure" -> AccessoryCommand.Configure(
                    capabilityId = capabilityId,
                    enabled = spec.getBoolean("enabled"),
                    rateHz = spec.getDouble("rateHz"),
                )

                "state" -> AccessoryCommand.State(
                    capabilityId = capabilityId,
                    telemetry = spec.getString("telemetry"),
                    mode = if (spec.isNull("mode")) null else spec.getString("mode"),
                    parked = spec.getString("parked"),
                    preview = spec.getBoolean("preview"),
                )

                else -> error("unknown command kind $kind in $name")
            }
            assertEquals(
                name,
                case.getString("line"),
                command.encode(sessionId, case.getInt("requestId")),
            )
        }
    }

    @Test
    fun everyResponseCaseMatchesTheSharedFixture() {
        val cases = fixture.getJSONArray("decode")
        assertTrue("fixture must carry decode cases", cases.length() > 0)
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            val name = case.getString("name")
            val parsed = AccessoryResponse.parse(case.getString("line"), sessionId)

            when {
                case.optBoolean("malformed") ->
                    assertEquals(name, AccessoryResponse.Malformed, parsed)

                case.optBoolean("ignored") ->
                    assertEquals(name, AccessoryResponse.Ignored, parsed)

                case.has("error") -> {
                    val expected = case.getJSONObject("error")
                    assertEquals(
                        name,
                        AccessoryResponse.Failed(expected.getInt("requestId"), expected.getString("code")),
                        parsed,
                    )
                }

                else -> {
                    val expected = case.getJSONObject("ack")
                    val ack = parsed as? AccessoryResponse.Ack ?: error("$name: expected an ack, got $parsed")
                    assertEquals(name, expected.getInt("requestId"), ack.requestId)
                    assertEquals(name, expected.getString("capabilityId"), ack.capabilityId)
                    assertEquals(name, expected.getLong("leaseMs"), ack.leaseMs)
                    // The applied values are compared as text so `20` and `20.0` cannot disagree
                    // across the two platforms that have to read the same line.
                    if (expected.has("appliedRateHz")) {
                        assertEquals(name, expected.getInt("appliedRateHz").toString(), ack.applied["rateHz"])
                    }
                    if (expected.has("appliedEnabled")) {
                        assertEquals(
                            name,
                            expected.getBoolean("appliedEnabled").toString(),
                            ack.applied["enabled"],
                        )
                    }
                    if (expected.has("appliedTelemetry")) {
                        assertEquals(name, expected.getString("appliedTelemetry"), ack.applied["telemetry"])
                    }
                    if (expected.has("appliedParked")) {
                        assertEquals(name, expected.getString("appliedParked"), ack.applied["parked"])
                    }
                }
            }
        }
    }

    @Test
    fun measurementRatesResolveAgainstWhatTheHardwareDeclared() {
        val cases = fixture.getJSONArray("rateResolution")
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            val rates = case.getJSONArray("ratesHz")
            val declared = (0 until rates.length()).map { rates.getDouble(it) }
            assertEquals(
                case.getString("name"),
                case.getDouble("resolved"),
                AccessorySession.resolveRateHz(case.getDouble("requested"), declared)!!,
                0.0,
            )
        }
    }

    @Test
    fun aCapabilityDeclaringNoRateIsNotConfigurable() {
        // Not a clamp to some default: a rate the hardware never offered is one this app invented,
        // and a sensor asked to run at it would be right to refuse.
        assertEquals(null, AccessorySession.resolveRateHz(20.0, emptyList()))
        assertEquals(null, AccessorySession.resolveRateHz(20.0, listOf(0.0, -5.0, Double.NaN)))
    }
}
