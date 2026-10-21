package expo.modules.vescapecore.runtime

import org.junit.Assert.assertEquals
import org.junit.Test

// @parity /modules/vescape-core/ios/runtime/BoardSessionLinkIntegrityTests.swift
class BoardSessionLinkIntegrityTest {
    private val complete = LinkIdentity(
        linkVersion = 4,
        hasBms = true,
        firmware = "FW 6.05",
        refloatVersion = "Refloat 3.0.7",
        refloatBaseVersion = "3.0.7",
    )

    @Test
    fun completeLinkStartsChecking() {
        val session = BoardSession(id = 1)

        assertEquals(LinkIntegrity.Checking, session.startLinkIntegrityCheck(complete))
    }

    @Test
    fun oldOrIncompleteLinkStartsOutdated() {
        val session = BoardSession(id = 1)

        assertEquals(LinkIntegrity.Checking, session.startLinkIntegrityCheck(complete.copy(linkVersion = null)))
        assertEquals(LinkIntegrity.Outdated, session.markOutdatedIfIncomplete(complete.copy(linkVersion = null)))
        assertEquals(LinkIntegrity.Outdated, session.markOutdatedIfIncomplete(complete.copy(linkVersion = 3)))
        assertEquals(LinkIntegrity.Outdated, session.markOutdatedIfIncomplete(complete.copy(hasBms = null)))
        assertEquals(LinkIntegrity.Outdated, session.markOutdatedIfIncomplete(complete.copy(firmware = null)))
    }

    @Test
    fun matchingFactsBecomeTrusted() {
        val session = BoardSession(id = 1)
        session.startLinkIntegrityCheck(complete)

        assertEquals(LinkIntegrity.Checking, session.observeFirmware(complete, "FW 6.05"))
        assertEquals(LinkIntegrity.Checking, session.observeRefloat(complete, "Refloat 3.0.7"))
        assertEquals(LinkIntegrity.Trusted, session.observeBms(complete))
    }

    @Test
    fun mismatchedFactsLatchForSession() {
        val session = BoardSession(id = 1)
        session.startLinkIntegrityCheck(complete)

        assertEquals(LinkIntegrity.Mismatched, session.observeFirmware(complete, "FW 6.06"))
        assertEquals(LinkIntegrity.Mismatched, session.observeFirmware(complete, "FW 6.05"))
    }

    @Test
    fun expectedBmsMissingMismatchesButFalseDoesNotNeedBms() {
        val withoutBms = complete.copy(hasBms = false)
        val trusted = BoardSession(id = 1)
        trusted.startLinkIntegrityCheck(withoutBms)
        trusted.observeFirmware(withoutBms, "FW 6.05")
        assertEquals(LinkIntegrity.Trusted, trusted.observeRefloat(withoutBms, "Refloat 3.0.7"))
        assertEquals(LinkIntegrity.Mismatched, trusted.observeBms(withoutBms))

        val missingBms = BoardSession(id = 2)
        missingBms.startLinkIntegrityCheck(complete)
        missingBms.observeFirmware(complete, "FW 6.05")
        missingBms.observeRefloat(complete, "Refloat 3.0.7")
        assertEquals(LinkIntegrity.Mismatched, missingBms.markBmsMissing(complete))
    }

    @Test
    fun unprovenCheckTimesOutToOutdated() {
        val session = BoardSession(id = 1)
        session.startLinkIntegrityCheck(complete)
        assertEquals(LinkIntegrity.Checking, session.observeFirmware(complete, "FW 6.05"))

        assertEquals(LinkIntegrity.Outdated, session.markCheckTimedOut())
    }

    @Test
    fun checkTimeoutLeavesASettledVerdictAlone() {
        val trusted = BoardSession(id = 1)
        trusted.startLinkIntegrityCheck(complete)
        trusted.observeFirmware(complete, "FW 6.05")
        trusted.observeRefloat(complete, "Refloat 3.0.7")
        assertEquals(LinkIntegrity.Trusted, trusted.observeBms(complete))
        assertEquals(LinkIntegrity.Trusted, trusted.markCheckTimedOut())

        val mismatched = BoardSession(id = 2)
        mismatched.startLinkIntegrityCheck(complete)
        assertEquals(LinkIntegrity.Mismatched, mismatched.observeFirmware(complete, "FW 6.06"))
        assertEquals(LinkIntegrity.Mismatched, mismatched.markCheckTimedOut())
    }

    // @legacy-float saved-link: compatibility regression group; see /docs/legacy-float.md#saved-link.
    @Test
    fun legacyInfoCanGainPackageAndPatchPrecisionWithoutInvalidatingLink() {
        val cases = listOf(
            "Refloat 1.2" to "Float/Refloat 1.2",
            "Refloat 1.2" to "Refloat 1.2.0",
            "Refloat 1.2" to "Refloat 1.2.7-beta",
            "Refloat 1.2" to "Float 1.2.7",
            "Float/Refloat 1.2" to "Refloat 1.2.7",
            "Float/Refloat 1.2" to "Float 1.2.0",
            "Float/Refloat 1.2" to "Float/Refloat 1.2",
        )
        for ((saved, observed) in cases) {
            val expected = complete.copy(
                refloatVersion = saved,
                refloatBaseVersion = LinkIdentity.normalizeRefloatBaseVersion(saved),
            )
            val session = BoardSession(id = 1)
            session.startLinkIntegrityCheck(expected)
            session.observeFirmware(expected, "FW 6.05")
            session.observeBms(expected)
            assertEquals("$saved -> $observed", LinkIntegrity.Trusted, session.observeRefloat(expected, observed))
        }
    }

    @Test
    fun compatibilityPreservesKnownIdentityFacts() {
        val cases = listOf(
            "Refloat 1.2" to "Float/Refloat 1.3",
            "Refloat 1.2" to "Refloat 2.2.0",
            "Refloat 1.2" to "Other 1.2.0",
            "Refloat 1.2.0" to "Float 1.2.0",
            "Refloat 1.2.0" to "Refloat 1.2.1",
            "Refloat 1.2.0-beta" to "Refloat 1.2.0",
            "Refloat 1.2.0" to "Float/Refloat 1.2",
            "Refloat 1.2.0" to "Refloat 1.2",
            "Refloat 1.2" to "Refloat 1.2.0 extra",
            "Refloat 1.2" to "Refloat 1.2.0\n",
            "Refloat unknown" to "Float/Refloat unknown",
        )
        for ((saved, observed) in cases) {
            val expected = complete.copy(
                refloatVersion = saved,
                refloatBaseVersion = LinkIdentity.normalizeRefloatBaseVersion(saved),
            )
            val session = BoardSession(id = 1)
            session.startLinkIntegrityCheck(expected)
            session.observeFirmware(expected, "FW 6.05")
            session.observeBms(expected)
            assertEquals("$saved -> $observed", LinkIntegrity.Mismatched, session.observeRefloat(expected, observed))
        }
    }

    @Test
    fun legacyCompatibilityStillRequiresAllFactsAndConsistentBaseVersion() {
        val expected = complete.copy(refloatVersion = "Refloat 1.2", refloatBaseVersion = "1.2")
        val session = BoardSession(id = 1)
        session.startLinkIntegrityCheck(expected)
        assertEquals(LinkIntegrity.Checking, session.observeRefloat(expected, "Refloat 1.2.0"))
        assertEquals(LinkIntegrity.Checking, session.observeFirmware(expected, "FW 6.05"))
        assertEquals(LinkIntegrity.Trusted, session.observeBms(expected))
        assertEquals(LinkIntegrity.Mismatched, session.observeFirmware(expected, "FW 6.06"))
        assertEquals(LinkIntegrity.Mismatched, session.observeFirmware(expected, "FW 6.05"))

        val inconsistent = expected.copy(refloatBaseVersion = "1.3")
        assertEquals(LinkIntegrity.Mismatched, BoardSession(id = 2).observeRefloat(inconsistent, "Refloat 1.2.0"))
        val missingBms = BoardSession(id = 3)
        missingBms.observeRefloat(expected, "Float/Refloat 1.2")
        assertEquals(LinkIntegrity.Mismatched, missingBms.markBmsMissing(expected))
    }
}
