package expo.modules.vescapecore.telemetry

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

  suspend fun saveAlert(rule: AlertRuleEntity) = dao.upsertAlertRule(rule)
  suspend fun alertRules(boardId: String): List<AlertRuleEntity> = dao.getAlertRules(boardId)
  suspend fun setAlertEnabled(boardId: String, id: String, enabled: Boolean) = dao.setAlertRuleEnabled(boardId, id, enabled)
  suspend fun deleteAlert(boardId: String, id: String) = dao.deleteAlertRule(boardId, id)
}
