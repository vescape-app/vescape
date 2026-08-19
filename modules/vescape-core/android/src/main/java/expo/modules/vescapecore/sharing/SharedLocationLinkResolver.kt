package expo.modules.vescapecore.sharing

import java.net.URI
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

data class ResolvedSharedLocation(
  val latitude: Double,
  val longitude: Double,
  val name: String?,
) {
  fun toBridgeMap(): Map<String, Any?> = mapOf(
    "latitude" to latitude,
    "longitude" to longitude,
    "name" to name,
  )
}

internal data class SharedLocationHttpResponse(
  val url: String,
  val location: String?,
  val body: String,
  val status: Int = 200,
)

/**
 * Resolves opaque map share links without a Maps API. Google uses different redirect chains for
 * Android and iOS shares, so redirects are deliberately stepped before the final browser-like GET.
 *
 * @parity /modules/vescape-core/ios/sharing/SharedLocationLinkResolver.swift
 * @parity /modules/vescape-core/src/index.ts `resolveSharedLocationLink`
 */
class SharedLocationLinkResolver internal constructor(
  private val request: suspend (String, Boolean, String, String?) -> SharedLocationHttpResponse,
) {
  constructor() : this(defaultRequest())

  suspend fun resolve(link: String): ResolvedSharedLocation? {
    var current = link
    repeat(MAX_REDIRECTS) {
      var response = request(current, false, SIMPLE_USER_AGENT, null)
      var attempts = 1
      while (response.status == 404 && attempts < MAX_RETRIES) {
        delay(RETRY_DELAY_MS)
        response = request(current, false, SIMPLE_USER_AGENT, null)
        attempts += 1
      }
      val destination = response.location?.let { resolveRedirect(current, it) }
        ?: return extract(current, response.body)
      current = destination
    }

    val consentDestination = googleConsentDestination(current)
    if (consentDestination != null) current = consentDestination
    val response = request(
      current,
      true,
      BROWSER_USER_AGENT,
      if (consentDestination != null) GOOGLE_CONSENT_COOKIE else null,
    )
    return extract(response.url, response.body)
  }

  companion object {
    private const val MAX_REDIRECTS = 2
    private const val MAX_RETRIES = 5
    private const val RETRY_DELAY_MS = 250L
    private const val GOOGLE_CONSENT_COOKIE = "SOCS=CAESHAgBEhIaAB; CONSENT=YES+"
    private const val SIMPLE_USER_AGENT = "Mozilla/5.0"
    private const val BROWSER_USER_AGENT =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

    private val PIN_PATTERN = Regex("!3d(-?\\d+(?:\\.\\d+)?)!4d(-?\\d+(?:\\.\\d+)?)")
    private val ROUTE_PATTERN = Regex("!\\d+d(-?\\d+(?:\\.\\d+)?)!\\d+d(-?\\d+(?:\\.\\d+)?)")
    private val INITIAL_STATE_PATTERN = Regex(
      "window\\.APP_INITIALIZATION_STATE=\\[\\[\\[-?\\d+(?:\\.\\d+)?,\\s*" +
        "(-?\\d+(?:\\.\\d+)?),\\s*(-?\\d+(?:\\.\\d+)?)",
    )
    private val STATIC_CENTER_PATTERN = Regex(
      "(?:center=|center%3D)(-?\\d+(?:\\.\\d+)?)(?:%2C|,)(-?\\d+(?:\\.\\d+)?)",
      RegexOption.IGNORE_CASE,
    )
    private val QUERY_PATTERN = Regex(
      "[?&](?:q|query|ll|sll|daddr|saddr|destination|center|coordinate)=(?:loc:)?" +
        "(-?\\d+(?:\\.\\d+)?)(?:%2C|,)(-?\\d+(?:\\.\\d+)?)",
      RegexOption.IGNORE_CASE,
    )
    private val OSM_MARKER_PATTERN = Regex(
      "[?&]mlat=(-?\\d+(?:\\.\\d+)?)(?:&|&amp;)mlon=(-?\\d+(?:\\.\\d+)?)",
      RegexOption.IGNORE_CASE,
    )
    private val VIEWPORT_PATTERN = Regex(
      "@(-?\\d+(?:\\.\\d+)?)(?:%2C|,)(-?\\d+(?:\\.\\d+)?)",
      RegexOption.IGNORE_CASE,
    )

    internal fun extract(url: String, body: String): ResolvedSharedLocation? {
      coordinateMatch(PIN_PATTERN.find(url), reversed = false)?.let { return it.withName(url) }
      coordinateMatch(ROUTE_PATTERN.find(url), reversed = false)?.let { return it.withName(url) }
      coordinateMatch(OSM_MARKER_PATTERN.find(url), reversed = false)?.let { return it.withName(url) }
      coordinateMatch(QUERY_PATTERN.find(url), reversed = false)?.let { return it.withName(url) }
      coordinateMatch(VIEWPORT_PATTERN.find(url), reversed = false)?.let { return it.withName(url) }
      coordinateMatch(INITIAL_STATE_PATTERN.find(body), reversed = true)?.let { return it.withName(url) }
      coordinateMatch(STATIC_CENTER_PATTERN.find(body), reversed = false)?.let { return it.withName(url) }
      return null
    }

    private fun coordinateMatch(match: MatchResult?, reversed: Boolean): ResolvedSharedLocation? {
      val first = match?.groupValues?.getOrNull(1)?.toDoubleOrNull() ?: return null
      val second = match.groupValues.getOrNull(2)?.toDoubleOrNull() ?: return null
      val latitude = if (reversed) second else first
      val longitude = if (reversed) first else second
      if (latitude !in -90.0..90.0 || longitude !in -180.0..180.0) return null
      return ResolvedSharedLocation(latitude, longitude, null)
    }

    private fun ResolvedSharedLocation.withName(url: String): ResolvedSharedLocation =
      copy(name = Regex("/maps/place/([^/@?#]+)", RegexOption.IGNORE_CASE).find(url)
        ?.groupValues?.getOrNull(1)
        ?.replace('+', ' ')
        ?.let { runCatching { java.net.URLDecoder.decode(it, Charsets.UTF_8.name()) }.getOrDefault(it) }
        ?.trim()
        ?.takeIf(String::isNotEmpty))

    private fun resolveRedirect(base: String, location: String): String =
      runCatching { URI(base).resolve(location).toString() }.getOrDefault(location)

    private fun googleConsentDestination(url: String): String? = runCatching {
      val uri = URI(url)
      if (!uri.host.equals("consent.google.com", ignoreCase = true)) return null
      uri.rawQuery
        ?.split('&')
        ?.firstOrNull { it.substringBefore('=') == "continue" }
        ?.substringAfter('=', "")
        ?.let { java.net.URLDecoder.decode(it, Charsets.UTF_8.name()) }
        ?.takeIf(String::isNotEmpty)
    }.getOrNull()

    private fun defaultRequest(): suspend (String, Boolean, String, String?) -> SharedLocationHttpResponse {
      val followingClient = OkHttpClient.Builder().followRedirects(true).build()
      val blockingClient = OkHttpClient.Builder().followRedirects(false).build()
      return { url, followRedirects, userAgent, cookie ->
        withContext(Dispatchers.IO) {
          val requestBuilder = Request.Builder().url(url).header("User-Agent", userAgent)
          if (cookie != null) requestBuilder.header("Cookie", cookie)
          val call = (if (followRedirects) followingClient else blockingClient).newCall(
            requestBuilder.build(),
          )
          call.execute().use { response ->
            SharedLocationHttpResponse(
              url = response.request.url.toString(),
              location = response.header("Location"),
              body = response.body?.string().orEmpty(),
              status = response.code,
            )
          }
        }
      }
    }
  }
}
