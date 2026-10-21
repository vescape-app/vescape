package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.alerts.AlertPresetSpec
import org.json.JSONObject

/** Production Tune History and Alert operations shared by AppDataRepository and host contracts. */
internal class TuneAlertPersistence(private val dao: TelemetryDao) {
  suspend fun createProfile(profile: TuneProfileEntity): TuneProfileEntity = dao.createTuneProfile(
    profile,
    TuneHistoryEntryEntity(profileId = profile.id, fieldsJson = profile.fieldsJson, createdAt = profile.createdAt),
  )

  suspend fun saveProfile(profileId: String, fieldsJson: String, updatedAt: Long): TuneProfileEntity =
    dao.saveTuneProfile(profileId, fieldsJson, updatedAt)

  suspend fun profile(id: String): TuneProfileEntity? = dao.getTuneProfile(id)?.also { JSONObject(it.fieldsJson) }
  suspend fun profiles(boardId: String, compatibility: String): List<TuneProfileEntity> =
    dao.getTuneProfilesByBoard(boardId, compatibility).also { profiles -> profiles.forEach { JSONObject(it.fieldsJson) } }
  suspend fun history(profileId: String): List<TuneHistoryEntryEntity> = dao.getTuneHistoryEntries(profileId).also { entries ->
    entries.forEach { JSONObject(it.fieldsJson) }
  }

  /** Rider rules only: preset rows change through `applyAlertPreset`, expanded points never. */
  suspend fun saveAlert(rule: AlertRuleEntity) = dao.upsertAlertRule(riderRule(rule))
  suspend fun alertRules(boardId: String, reportPresetFailure: (Throwable) -> Unit): List<AlertRuleEntity> =
    AlertPresetPersistence.expandedRules(dao, boardId, reportPresetFailure)
  suspend fun setAlertEnabled(boardId: String, id: String, enabled: Boolean) = dao.setAlertRuleEnabled(boardId, riderId(id), enabled)
  suspend fun deleteAlert(boardId: String, id: String) = dao.deleteAlertRule(boardId, riderId(id))

  private fun riderId(id: String) = id.also { require(!AlertPresetPersistence.isPresetId(it)) { "Alert Preset rules are not editable" } }

  /** [rule] when it is a rider's rule: not a preset id and not a preset spec. */
  fun riderRule(rule: AlertRuleEntity) = rule.also {
    riderId(it.id)
    require(AlertPresetSpec.parse(it.spec) == null) { "A rider rule cannot hold a preset spec" }
  }
}

/** Tune compatibility ignores patch and suffix; Board Link identity retains both.
 * @parity /modules/vescape-core/ios/telemetry/TuneProfileStore.swift `validRefloatBaseVersion`
 * @parity /src/modules/tune/lib/tuneCompatibility.ts `tuneCompatibilityVersion`
 */
internal fun tuneCompatibilityVersion(value: String?): String? =
  value?.let { Regex("""^(\d+\.\d+)(?:\.\d+)?(?:[-+].*)?$""").matchEntire(it)?.groupValues?.get(1) }
