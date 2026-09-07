package expo.modules.vescapecore.warnings

/** @parity /modules/vescape-core/ios/warnings/BoardWarningStore.swift `Record.warning` */
enum class BoardWarningSeverity(val wire: String) {
  WARN("warn"),
  CRITICAL("critical");

  companion object {
    fun fromWire(value: String): BoardWarningSeverity =
      requireNotNull(entries.firstOrNull { it.wire == value }) { "Invalid Board Warning severity" }
  }
}
