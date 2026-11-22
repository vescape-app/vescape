package expo.modules.vescapecore.service

import android.content.Context

internal object CompanionRestartGate {
    private const val PREFS = "vesc_companion_restart_gate"
    private const val KEY_SUPPRESSED_UNTIL = "suppressed_until"

    fun suppressFor(context: Context, minutes: Int) {
        if (minutes <= 0) return
        prefs(context).edit()
            .putLong(KEY_SUPPRESSED_UNTIL, System.currentTimeMillis() + minutes * 60_000L)
            .apply()
    }

    fun isSuppressed(context: Context): Boolean =
        System.currentTimeMillis() < prefs(context).getLong(KEY_SUPPRESSED_UNTIL, 0L)

    fun clear(context: Context) {
        prefs(context).edit().remove(KEY_SUPPRESSED_UNTIL).apply()
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
