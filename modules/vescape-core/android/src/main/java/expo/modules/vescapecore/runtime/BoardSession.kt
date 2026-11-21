package expo.modules.vescapecore.runtime

// @parity /modules/vescape-core/ios/runtime/BoardSession.swift
class BoardSession(val id: Long) {
    @Volatile
    var isActive: Boolean = true
        private set

    @Volatile
    var linkIntegrity: LinkIntegrity = LinkIntegrity.Unknown
        private set
    @Volatile
    var linkIntegrityProbeStarted: Boolean = false
        private set

    fun invalidate() {
        isActive = false
    }

    fun startLinkIntegrityCheck(expected: LinkIdentity): LinkIntegrity {
        linkIntegrity = LinkIntegrity.Checking
        return linkIntegrity
    }

    fun markOutdatedIfIncomplete(expected: LinkIdentity): LinkIntegrity {
        if (!expected.isComplete) linkIntegrity = LinkIntegrity.Outdated
        return linkIntegrity
    }

    fun markCheckTimedOut(): LinkIntegrity {
        if (linkIntegrity == LinkIntegrity.Checking) linkIntegrity = LinkIntegrity.Outdated
        return linkIntegrity
    }

    fun claimLinkIntegrityProbe(): Boolean {
        if (linkIntegrityProbeStarted) return false
        linkIntegrityProbeStarted = true
        return true
    }

    fun observeFirmware(expected: LinkIdentity, firmware: String): LinkIntegrity =
        updateLinkIntegrity(expected) { copy(firmware = firmware) }

    fun observeRefloat(expected: LinkIdentity, refloatVersion: String): LinkIntegrity =
        updateLinkIntegrity(expected) {
            copy(
                refloatVersion = refloatVersion,
                refloatBaseVersion = LinkIdentity.normalizeRefloatBaseVersion(refloatVersion),
            )
        }

    fun observeBms(expected: LinkIdentity): LinkIntegrity =
        updateLinkIntegrity(expected) { copy(hasBms = true) }

    fun markBmsMissing(expected: LinkIdentity): LinkIntegrity {
        if (linkIntegrity == LinkIntegrity.Mismatched) return linkIntegrity
        if (expected.hasBms == true && observations.hasBms != true) {
            linkIntegrity = LinkIntegrity.Mismatched
        }
        return linkIntegrity
    }

    private var observations = LinkIdentity(linkVersion = LinkIdentity.CURRENT_LINK_VERSION)

    private fun updateLinkIntegrity(
        expected: LinkIdentity,
        mutate: LinkIdentity.() -> LinkIdentity,
    ): LinkIntegrity {
        if (linkIntegrity == LinkIntegrity.Outdated || linkIntegrity == LinkIntegrity.Mismatched) return linkIntegrity
        observations = observations.mutate()
        linkIntegrity = when {
            !expected.isComplete -> LinkIntegrity.Outdated
            expected.mismatches(observations) -> LinkIntegrity.Mismatched
            expected.matches(observations) -> LinkIntegrity.Trusted
            else -> LinkIntegrity.Checking
        }
        return linkIntegrity
    }
}

// @parity /modules/vescape-core/ios/runtime/BoardSession.swift
// @parity /modules/vescape-core/src/index.ts `LinkIntegrity`
enum class LinkIntegrity(val wireValue: String) {
    Unknown("unknown"),
    Checking("checking"),
    Trusted("trusted"),
    Outdated("outdated"),
    Mismatched("mismatched"),
}

// @parity /modules/vescape-core/ios/runtime/BoardSession.swift
data class LinkIdentity(
    val linkVersion: Int? = null,
    val hasBms: Boolean? = null,
    val firmware: String? = null,
    val refloatVersion: String? = null,
    val refloatBaseVersion: String? = null,
) {
    val isComplete: Boolean
        get() = linkVersion == CURRENT_LINK_VERSION &&
            hasBms != null &&
            !firmware.isNullOrBlank() &&
            !refloatVersion.isNullOrBlank()

    fun mismatches(observed: LinkIdentity): Boolean =
        (observed.firmware != null && observed.firmware != firmware) ||
            (observed.refloatVersion != null && !packageVersionMatches(observed)) ||
            (observed.refloatBaseVersion != null && !baseVersionMatches(observed)) ||
            (hasBms != null && observed.hasBms != null && observed.hasBms != hasBms)

    fun matches(observed: LinkIdentity): Boolean =
        observed.firmware == firmware &&
            packageVersionMatches(observed) &&
            baseVersionMatches(observed) &&
            (hasBms != true || observed.hasBms == true)

    private fun packageVersionMatches(observed: LinkIdentity): Boolean {
        if (refloatVersion == observed.refloatVersion) return true
        val legacy = legacyPackageVersion.matchEntire(refloatVersion ?: return false) ?: return false
        val current = compatiblePackageVersion.matchEntire(observed.refloatVersion ?: return false) ?: return false
        return legacy.groupValues[1] == current.groupValues[1]
    }

    private fun baseVersionMatches(observed: LinkIdentity): Boolean =
        refloatBaseVersion == observed.refloatBaseVersion ||
            (packageVersionMatches(observed) &&
                refloatBaseVersion == normalizeRefloatBaseVersion(refloatVersion) &&
                observed.refloatBaseVersion == normalizeRefloatBaseVersion(observed.refloatVersion))

    companion object {
        const val CURRENT_LINK_VERSION = 4

        private val legacyPackageVersion = Regex("""^(?:Refloat|Float/Refloat) (\d+\.\d+)$""")
        private val compatiblePackageVersion = Regex("""^(?:Float|Refloat|Float/Refloat) (\d+\.\d+)(?:\.\d+(?:-.+)?)?$""")

        fun normalizeRefloatBaseVersion(version: String?): String? =
            version
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
                ?.let { Regex("""\b(\d+\.\d+(?:\.\d+)?)\b""").find(it)?.groupValues?.get(1) }
    }
}
