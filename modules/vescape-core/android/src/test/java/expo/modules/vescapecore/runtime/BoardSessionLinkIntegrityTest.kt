package expo.modules.vescapecore.runtime

import org.junit.Assert.assertEquals
import org.junit.Test

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
}
