package expo.modules.vescapecore.service

import android.content.Context

internal object ManualDisconnectAutoStartGate {
    private const val PREFS = "vesc_manual_disconnect_auto_start_gate"
    private const val KEY_BOARD_ID = "board_id"

    fun suppress(context: Context, boardId: String?) {
        if (boardId.isNullOrBlank()) return
        prefs(context).edit().putString(KEY_BOARD_ID, boardId).apply()
    }

    fun isSuppressed(context: Context, boardId: String?): Boolean =
        !boardId.isNullOrBlank() && prefs(context).getString(KEY_BOARD_ID, null) == boardId

    fun clear(context: Context) {
        prefs(context).edit().remove(KEY_BOARD_ID).apply()
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
