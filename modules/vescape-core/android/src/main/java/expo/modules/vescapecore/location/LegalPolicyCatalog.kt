package expo.modules.vescapecore.location

import android.content.Context
import java.util.Locale
import org.json.JSONArray
import expo.modules.vescapecore.diagnostics.UnexpectedNativeError

internal data class LegalPolicySpeeds(
    val warningSpeedKmh: Double,
    val limitSpeedKmh: Double,
)

/**
 * Bundled Legal Policy lookup used by jurisdiction resolution and Legal Mode alert synthesis.
 *
 * @parity /modules/vescape-core/ios/location/LegalPolicyCatalog.swift
 */
internal class LegalPolicyCatalog(context: Context) {
    private var loadFailed = false
    private val rows by lazy {
        try {
            val json = context.assets.open("data/legal-policies.json").bufferedReader().use { it.readText() }
            parseLegalPolicies(json).ifEmpty { error("Required Legal Policy catalog is empty") }
        } catch (error: Exception) {
            loadFailed = true
            UnexpectedNativeError.report("legal_policy_catalog_load", "bundled_asset", error)
            emptyMap()
        }
    }

    val countryCodes: Set<String> get() = rows.keys
    val isAvailable: Boolean get() { rows; return !loadFailed }

    fun speeds(countryCode: String): LegalPolicySpeeds? = rows[countryCode.trim().uppercase(Locale.ROOT)]
}

internal fun parseLegalPolicies(json: String): Map<String, LegalPolicySpeeds> {
    // intentional-suppression: catalog owner reports unavailable policy data
    val rows = runCatching { JSONArray(json) }.getOrNull() ?: return emptyMap()
    return buildMap {
        for (index in 0 until rows.length()) {
            val row = rows.optJSONObject(index) ?: continue
            val code = row.optString("code").trim().uppercase(Locale.ROOT).takeIf { it.length == 2 }
                ?: continue
            val limit = row.optDouble("legalSpeedKmh").takeIf { it.isFinite() && it > 0.0 }
                ?: row.optDouble("referenceSpeedKmh").takeIf { it.isFinite() && it > 0.0 }
            val warning = row.optDouble("warningSpeedKmh").takeIf { it.isFinite() && it > 0.0 }
                ?: limit?.minus(5.0)?.takeIf { it > 0.0 }
            if (limit != null && warning != null && warning < limit) {
                put(code, LegalPolicySpeeds(warning, limit))
            }
        }
    }
}
