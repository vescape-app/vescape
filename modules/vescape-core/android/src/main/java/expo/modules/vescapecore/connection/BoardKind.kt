package expo.modules.vescapecore.connection

/**
 * Board family. Persisted as a board setting (`kind`); absent means VESC for every board saved
 * before OneWheel existed. Drives the session branch in BoardSessionController.consumePendingStart.
 *
 * @parity /modules/vescape-core/src/index.ts `BoardKind`
 */
// TODO(iOS parity): OneWheel sessions are Android-only for now.
enum class BoardKind(val wireValue: String) {
  Vesc("vesc"),
  OneWheel("onewheel"),
  ;

  companion object {
    fun fromWire(value: Any?): BoardKind = when (value) {
      "onewheel" -> OneWheel
      else -> Vesc
    }
  }
}
