package expo.modules.vescapecore.location

import android.content.Context
import android.location.Geocoder
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.CancellationException

internal sealed interface LegalPolicyResolution {
    data class Resolved(val countryCode: String?) : LegalPolicyResolution
    data object Unavailable : LegalPolicyResolution
}

/**
 * Native OS reverse geocoder constrained by the bundled Legal Policy catalog.
 *
 * @parity /modules/vescape-core/ios/location/LegalPolicyResolver.swift
 */
internal class LegalPolicyResolver(private val context: Context) {
    private val catalog = LegalPolicyCatalog(context)

    @Suppress("DEPRECATION")
    suspend fun resolve(latitude: Double, longitude: Double): LegalPolicyResolution = withContext(Dispatchers.IO) {
        val address = try {
            Geocoder(context, Locale.getDefault()).getFromLocation(latitude, longitude, 1)?.firstOrNull()
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            return@withContext LegalPolicyResolution.Unavailable
        }
        val rawCode = address?.countryCode
        if (!catalog.isAvailable || rawCode == null) LegalPolicyResolution.Unavailable
        else LegalPolicyResolution.Resolved(normalizeCountryCode(rawCode, catalog.countryCodes))
    }
}

internal fun normalizeCountryCode(raw: String?, supported: Set<String>): String? {
    val code = raw?.trim()?.uppercase(Locale.ROOT) ?: return null
    return code.takeIf(supported::contains)
}
