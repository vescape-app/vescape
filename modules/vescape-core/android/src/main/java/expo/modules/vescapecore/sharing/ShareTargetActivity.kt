package expo.modules.vescapecore.sharing

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

/**
 * Vescape as a share destination for locations. Android hands a share to whichever activity
 * declared the filter, and the payload arrives as intent extras that nothing on the JS side can
 * read; this activity turns it into the one link both platforms deliver a shared location through.
 *
 * It renders nothing and never sits in the back stack: from the rider's side, sharing a place goes
 * straight from the other app's share sheet to the Vescape map.
 *
 * @parity /src/modules/map/screens/SharedLocationScreen.tsx
 * @parity /targets/shared-location/ShareLocationViewController.swift
 * @platform-diff Android receives the payload as a share intent; iOS has no equivalent and needs a
 * share extension to reach the app at all. Both end at the same `vescape://shared-location` link.
 */
class ShareTargetActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val payload = readPayload(intent)
    startActivity(
      Intent(Intent.ACTION_VIEW, sharedLocationLink(payload))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
    )
    finish()
  }

  /**
   * Everything the sharing app offered as text, in the order it is worth reading. An empty result
   * is forwarded rather than dropped: "nothing usable was shared" is an answer the rider is owed,
   * and the map is where it is said.
   */
  private fun readPayload(intent: Intent): String =
    when (intent.action) {
      Intent.ACTION_SEND ->
        intent.getStringExtra(Intent.EXTRA_TEXT)
          ?: intent.getStringExtra(Intent.EXTRA_SUBJECT)
          ?: intent.dataString
      else -> intent.dataString ?: intent.getStringExtra(Intent.EXTRA_TEXT)
    }.orEmpty()

  private fun sharedLocationLink(payload: String): Uri =
    Uri.Builder()
      .scheme("vescape")
      .authority("shared-location")
      .appendQueryParameter("text", payload)
      .build()
}
