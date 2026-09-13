package expo.modules.vescapecore.accessory

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The discovery handshake contract, driven by
 * `shared/fixtures/accessory-protocol/handshake.json`: the exact `hello` line discovery writes, and
 * every manifest the parser must either accept with a compatibility verdict or refuse outright.
 *
 * @parity /modules/vescape-core/ios/accessory/AccessoryProtocolTests.swift
 */
class AccessoryProtocolTest {
    private val fixture = AccessoryFixtures.load("handshake.json")
    private val hello = fixture.getJSONObject("hello")
    private val sessionId = hello.getString("sessionId")

    @Test
    fun helloIsEncodedByteForByteAsTheFixturePinsIt() {
        assertEquals(hello.getString("line"), AccessoryProtocol.encodeHello(sessionId))
        val offered = hello.getJSONArray("supportedVersions")
        assertEquals(offered.length(), AccessoryProtocol.SUPPORTED_VERSIONS.size)
        for (i in 0 until offered.length()) {
            assertEquals(offered.getInt(i), AccessoryProtocol.SUPPORTED_VERSIONS[i])
        }
    }

    @Test
    fun recognizedCapabilityTypesMatchTheSharedFixture() {
        val types = fixture.getJSONArray("recognizedCapabilityTypes")
        val declared = (0 until types.length()).map { types.getString(it) }.toSet()
        assertEquals(
            setOf(AccessoryProtocol.TYPE_GROUND_CLEARANCE, AccessoryProtocol.TYPE_BRAKE_LIGHT),
            declared,
        )
    }

    @Test
    fun everyManifestCaseMatchesTheSharedFixture() {
        val cases = fixture.getJSONArray("cases")
        assertTrue("fixture must carry cases", cases.length() > 0)
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            val name = case.getString("name")
            val result = AccessoryProtocol.parseManifest(case.getString("line"), sessionId)

            if (!case.isNull("error")) {
                val failed = result as? ManifestResult.Failed
                    ?: throw AssertionError("$name: expected rejection, got $result")
                assertEquals("$name: error", case.getString("error"), failed.error.wire)
                continue
            }

            val ok = result as? ManifestResult.Ok
                ?: throw AssertionError("$name: expected a manifest, got $result")
            assertManifest(name, case.getJSONObject("expected"), ok.manifest)
        }
    }

    private fun assertManifest(name: String, expected: JSONObject, actual: AccessoryManifest) {
        assertEquals("$name: accessoryId", expected.getString("accessoryId"), actual.accessoryId)
        assertEquals("$name: name", expected.getString("name"), actual.name)
        assertEquals(
            "$name: firmwareVersion",
            expected.getString("firmwareVersion"),
            actual.firmwareVersion,
        )
        if (expected.isNull("protocolVersion")) {
            assertNull("$name: protocolVersion", actual.protocolVersion)
        } else {
            assertEquals(
                "$name: protocolVersion",
                expected.getInt("protocolVersion"),
                actual.protocolVersion,
            )
        }
        val versions = expected.getJSONArray("supportedVersions")
        assertEquals("$name: supportedVersions size", versions.length(), actual.supportedVersions.size)
        for (i in 0 until versions.length()) {
            assertEquals("$name: supportedVersions[$i]", versions.getInt(i), actual.supportedVersions[i])
        }
        assertEquals(
            "$name: compatibility",
            expected.getString("compatibility"),
            actual.compatibility.wire,
        )

        val caps = expected.getJSONArray("capabilities")
        assertEquals("$name: capability count", caps.length(), actual.capabilities.size)
        for (i in 0 until caps.length()) {
            val want = caps.getJSONObject(i)
            val got = actual.capabilities[i]
            assertEquals("$name: capability $i id", want.getString("id"), got.id)
            assertEquals("$name: capability $i type", want.getString("type"), got.type)
            assertEquals(
                "$name: capability $i supported",
                want.getBoolean("supported"),
                got.supported,
            )
            assertEquals(
                "$name: capability $i unit",
                if (want.isNull("unit")) null else want.getString("unit"),
                got.unit,
            )
            assertEquals(
                "$name: capability $i rangeMin",
                if (want.isNull("rangeMin")) null else want.getDouble("rangeMin"),
                got.rangeMin,
            )
            assertEquals(
                "$name: capability $i rangeMax",
                if (want.isNull("rangeMax")) null else want.getDouble("rangeMax"),
                got.rangeMax,
            )
            val rates = want.getJSONArray("ratesHz")
            assertEquals("$name: capability $i rate count", rates.length(), got.ratesHz.size)
            for (r in 0 until rates.length()) {
                assertEquals(
                    "$name: capability $i rate $r",
                    rates.getDouble(r),
                    got.ratesHz[r],
                    0.0,
                )
            }
        }
    }

    /**
     * Discovery must not be able to speak past `hello`. There is one encoder on this path and it
     * produces one message type; anything operational would have to be added here first.
     */
    @Test
    fun discoveryEncodesNothingButHello() {
        val line = AccessoryProtocol.encodeHello(sessionId)
        assertEquals("hello", JSONObject(line).getString("type"))
        assertEquals(AccessoryProtocol.HELLO_REQUEST_ID, JSONObject(line).getInt("requestId"))
        assertEquals(
            setOf("type", "requestId", "sessionId", "supportedVersions"),
            JSONObject(line).keys().asSequence().toSet(),
        )
    }
}
