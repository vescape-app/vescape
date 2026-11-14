package expo.modules.vescapecore

import android.content.Context
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener
import expo.modules.vescapecore.splash.LaunchSplash

class VescapeCorePackage : Package {
  override fun createReactActivityLifecycleListeners(
    activityContext: Context,
  ): List<ReactActivityLifecycleListener> = listOf(LaunchSplash)
}
