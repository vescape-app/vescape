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

    /**
     * The probe ran but never proved the link either way. Nothing here says the board changed, only
     * that trust could not be established, so this resolves to `Outdated` — the state whose CTA asks
     * the rider to re-link. A `Checking` that never ends is a dead end: commands stay blocked and no
     * warning offers a way out.
     */
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

    private var observations = LinkIdentity(linkVersion = 4)

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
    // refloatBaseVersion is derived from refloatVersion and may be absent for malformed or unknown
    // version strings, so it is not required here; matches/mismatches still compare it when present.
    val isComplete: Boolean
        get() = linkVersion == 4 &&
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

    // @legacy-float saved-link: keep until legacy saved links migrate or require explicit re-link.
    // Removal checklist: /docs/legacy-float.md#saved-link
    // INFO v1 reported only major/minor, and older app versions asserted "Refloat" even for Float.
    // Accept richer observations only for those saved identities. Never discard package, patch or
    // suffix facts already captured by INFO v2, or broaden this to unrelated packages.
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
        private val legacyPackageVersion = Regex("""^(?:Refloat|Float/Refloat) (\d+\.\d+)$""")
        private val compatiblePackageVersion = Regex("""^(?:Float|Refloat|Float/Refloat) (\d+\.\d+)(?:\.\d+(?:-.+)?)?$""")

        fun normalizeRefloatBaseVersion(version: String?): String? =
            version
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
                ?.let { Regex("""\b(\d+\.\d+(?:\.\d+)?)\b""").find(it)?.groupValues?.get(1) }
    }
}
