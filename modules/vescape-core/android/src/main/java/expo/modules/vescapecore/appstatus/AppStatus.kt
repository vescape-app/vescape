package expo.modules.vescapecore.appstatus

import org.json.JSONArray
import org.json.JSONObject

/**
 * Release Policy outcome for the installed marketing version, resolved **by the server**. Native
 * never evaluates SemVer ranges — it only carries the resolved slug across the bridge.
 *
 * @parity /modules/vescape-core/ios/appstatus/AppStatus.swift `AppVersionStatus`
 * @parity /modules/vescape-core/src/index.ts `AppVersionStatus`
 */
enum class AppVersionStatus(val slug: String) {
  CURRENT("current"),
  UPDATE_WARNING("update-warning"),
  ONLINE_BLOCKED("online-blocked"),
  APP_BLOCKED("app-blocked"),
  ;

  /**
   * Whether this outcome denies online work (Group Ride and future backup/sync). Online Block and
   * App Block both deny it; `current` and `update-warning` permit it. No TS peer: only the native
   * Group Ride gate consumes it, and JS learns of a block via the `blocked` observe state.
   *
   * @parity /modules/vescape-core/ios/appstatus/AppStatus.swift `blocksOnline`
   */
  val blocksOnline: Boolean
    get() = this == ONLINE_BLOCKED || this == APP_BLOCKED

  companion object {
    fun fromSlug(slug: String): AppVersionStatus? = entries.firstOrNull { it.slug == slug }
  }
}

/**
 * @parity /modules/vescape-core/ios/appstatus/AppStatus.swift `CommunityMessageType`
 * @parity /modules/vescape-core/src/index.ts `CommunityMessageType`
 */
enum class CommunityMessageType(val slug: String) {
  INFO("info"),
  WARNING("warning"),
  CRITICAL("critical"),
  ;

  companion object {
    fun fromSlug(slug: String): CommunityMessageType? = entries.firstOrNull { it.slug == slug }
  }
}

/**
 * @parity /modules/vescape-core/ios/appstatus/AppStatus.swift `CommunityMessageActionType`
 * @parity /modules/vescape-core/src/index.ts `CommunityMessageActionType`
 */
enum class CommunityMessageActionType(val slug: String) {
  PRIMARY("primary"),
  SECONDARY("secondary"),
  ;

  companion object {
    fun fromSlug(slug: String): CommunityMessageActionType? = entries.firstOrNull { it.slug == slug }
  }
}

/**
 * @parity /modules/vescape-core/ios/appstatus/AppStatus.swift `CommunityMessageAction`
 * @parity /modules/vescape-core/src/index.ts `CommunityMessageAction`
 */
data class CommunityMessageAction(
  val type: CommunityMessageActionType,
  val label: String,
  val url: String,
) {
  fun toMap(): Map<String, Any?> = mapOf("type" to type.slug, "label" to label, "url" to url)
}

/**
 * @parity /modules/vescape-core/ios/appstatus/AppStatus.swift `CommunityMessage`
 * @parity /modules/vescape-core/src/index.ts `CommunityMessage`
 */
data class CommunityMessage(
  val id: String,
  val type: CommunityMessageType,
  val title: String?,
  val body: String,
  val action: CommunityMessageAction?,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "id" to id,
    "type" to type.slug,
    "title" to title,
    "body" to body,
    "action" to action?.toMap(),
  )
}

/**
 * @parity /modules/vescape-core/ios/appstatus/AppStatus.swift `AppStatusVersion`
 * @parity /modules/vescape-core/src/index.ts `AppStatusVersion`
 */
data class AppStatusVersion(
  val installed: String,
  val latest: String,
  val status: AppVersionStatus,
  val message: String?,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "installed" to installed,
    "latest" to latest,
    "status" to status.slug,
    "message" to message,
  )
}

/**
 * One resolved App Status snapshot as served by `GET /api/app-status`. Held in memory for the
 * running process only — never persisted, so a fresh process starts unknown (fail-open).
 *
 * @parity /modules/vescape-core/ios/appstatus/AppStatus.swift `AppStatus`
 * @parity /modules/vescape-core/src/index.ts `AppStatus`
 */
data class AppStatus(
  val version: AppStatusVersion,
  val messages: List<CommunityMessage>,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "version" to version.toMap(),
    "messages" to messages.map { it.toMap() },
  )
}

/**
 * Decode an App Status response body. Unknown additive fields are ignored; any invalid or missing
 * **required** field yields `null`, which callers treat exactly like a transport failure.
 *
 * @parity /modules/vescape-core/ios/appstatus/AppStatus.swift `decodeAppStatus`
 */
fun parseAppStatus(body: String): AppStatus? {
  val root = try {
    JSONObject(body)
  } catch (_: Exception) {
    return null
  }
  val version = parseVersion(root.optJSONObject("version") ?: return null) ?: return null
  return AppStatus(version = version, messages = parseMessages(root.opt("messages")))
}

private fun parseVersion(json: JSONObject): AppStatusVersion? {
  val installed = json.nonEmptyString("installed") ?: return null
  val latest = json.nonEmptyString("latest") ?: return null
  val status = AppVersionStatus.fromSlug(json.nonEmptyString("status") ?: return null) ?: return null
  // Absent message is legitimate (a rule may carry none); a present-but-malformed one is not.
  val message = if (json.has("message") && !json.isNull("message")) {
    json.nonEmptyString("message") ?: return null
  } else {
    null
  }
  return AppStatusVersion(installed = installed, latest = latest, status = status, message = message)
}

/**
 * Decode the message array. Community Messages are independent of Release Policy, so nothing here
 * can invalidate the resolved version status: an absent, null or non-array `messages` field means
 * "no messages", and an individual invalid entry is skipped so one bad message never hides the
 * valid ones.
 */
private fun parseMessages(value: Any?): List<CommunityMessage> {
  val array = value as? JSONArray ?: return emptyList()
  val messages = mutableListOf<CommunityMessage>()
  for (i in 0 until array.length()) {
    val obj = array.optJSONObject(i) ?: continue
    parseMessage(obj)?.let { messages.add(it) }
  }
  return messages
}

private fun parseMessage(json: JSONObject): CommunityMessage? {
  val id = json.nonEmptyString("id") ?: return null
  val type = CommunityMessageType.fromSlug(json.nonEmptyString("type") ?: return null) ?: return null
  // Absent title is legitimate (the app falls back to its per-type label); a malformed one is not.
  val title = if (json.has("title") && !json.isNull("title")) {
    json.nonEmptyString("title") ?: return null
  } else {
    null
  }
  val body = json.nonEmptyString("body") ?: return null
  val action = if (json.has("action") && !json.isNull("action")) {
    parseAction(json.optJSONObject("action") ?: return null) ?: return null
  } else {
    null
  }
  return CommunityMessage(id = id, type = type, title = title, body = body, action = action)
}

private fun parseAction(json: JSONObject): CommunityMessageAction? {
  val type =
    CommunityMessageActionType.fromSlug(json.nonEmptyString("type") ?: return null) ?: return null
  val label = json.nonEmptyString("label") ?: return null
  val url = json.nonEmptyString("url") ?: return null
  return CommunityMessageAction(type = type, label = label, url = url)
}

/** A required string field: present, textual, and non-empty — otherwise `null`. */
private fun JSONObject.nonEmptyString(key: String): String? {
  if (isNull(key)) return null
  val value = opt(key) as? String ?: return null
  return value.ifEmpty { null }
}
