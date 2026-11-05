package expo.modules.vescapecore.splash

import android.animation.ObjectAnimator
import android.animation.PropertyValuesHolder
import android.animation.ValueAnimator
import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.animation.AccelerateDecelerateInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import expo.modules.core.interfaces.ReactActivityLifecycleListener
import expo.modules.splashscreen.SplashScreenManager

/**
 * Animated launch splash. A native overlay drawn like the system splash goes up as soon as the
 * activity exists, long before JS loads, and animates the logo until JS calls [hide].
 *
 * Once the overlay is attached, the static system splash is released straight away, so motion
 * starts during the native launch phase instead of after JS boots.
 *
 * @parity /modules/vescape-core/ios/splash/LaunchSplash.swift
 */
object LaunchSplash : ReactActivityLifecycleListener {
  /** The `expo-splash-screen` icon bitmap: a square with the logo padded to `SPLASH_LOGO_WIDTH`. */
  private const val ICON_SIZE_DP = 288
  private const val PULSE_SCALE = 1.04f
  private const val PULSE_MS = 1200L
  private const val EXIT_FADE_MS = 250L

  private var overlay: View? = null
  private var pulse: ValueAnimator? = null
  private var dismissed = false

  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    if (dismissed) return
    // Posted so it runs after React Native has set the content view.
    activity.window.decorView.post { attach(activity) }
  }

  private fun attach(activity: Activity) {
    if (dismissed) return
    val res = activity.resources
    // Generated into the app module by the expo-splash-screen config plugin.
    val logoId = res.getIdentifier("splashscreen_logo", "drawable", activity.packageName)
    val backgroundId = res.getIdentifier("splashscreen_background", "color", activity.packageName)
    if (logoId == 0 || backgroundId == 0) return

    // A recreated activity (rotation while splashing) takes the overlay over.
    detach()
    val size = (ICON_SIZE_DP * res.displayMetrics.density).toInt()
    val logo = ImageView(activity).apply {
      setImageResource(logoId)
      scaleType = ImageView.ScaleType.FIT_CENTER
    }
    val frame = FrameLayout(activity).apply {
      setBackgroundColor(activity.getColor(backgroundId))
      isClickable = true // swallow touches while visible
      addView(logo, FrameLayout.LayoutParams(size, size, Gravity.CENTER))
    }
    (activity.window.decorView as ViewGroup).addView(
      frame,
      ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
    )
    overlay = frame
    pulse = ObjectAnimator.ofPropertyValuesHolder(
      logo,
      PropertyValuesHolder.ofFloat(View.SCALE_X, 1f, PULSE_SCALE),
      PropertyValuesHolder.ofFloat(View.SCALE_Y, 1f, PULSE_SCALE),
    ).apply {
      duration = PULSE_MS
      repeatMode = ValueAnimator.REVERSE
      repeatCount = ValueAnimator.INFINITE
      interpolator = AccelerateDecelerateInterpolator()
      start()
    }
    // The overlay now stands in for the system splash; let the system one go.
    SplashScreenManager.hide()
  }

  /** Fades the overlay out. Main thread only. */
  fun hide() {
    dismissed = true
    val view = overlay ?: return
    view.animate().alpha(0f).setDuration(EXIT_FADE_MS).withEndAction(::detach).start()
  }

  private fun detach() {
    pulse?.cancel()
    pulse = null
    overlay?.let { (it.parent as? ViewGroup)?.removeView(it) }
    overlay = null
  }
}
