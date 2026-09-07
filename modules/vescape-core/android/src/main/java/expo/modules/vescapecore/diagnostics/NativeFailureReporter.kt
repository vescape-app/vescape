package expo.modules.vescapecore.diagnostics

import io.sentry.Sentry
import io.sentry.SentryLevel

internal data class NativeFailureReport(
  val operation: String,
  val category: String,
  val errorType: String,
  val errorCode: Int?,
)

/**
 * Process-scoped, operation-keyed deduplication shared by persistence and other native failures.
 * @parity /modules/vescape-core/ios/diagnostics/NativeFailureReporter.swift
 */
internal class NativeFailureReporter(private val sink: (NativeFailureReport) -> Unit) {
  private val reported = mutableSetOf<String>()

  fun report(operation: String, category: String, error: Throwable) {
    val report = synchronized(this) {
      if (!reported.add(operation)) return
      NativeFailureReport(operation, category, error.javaClass.simpleName, errorCode(error))
    }
    sink(report)
  }

  private fun errorCode(error: Throwable): Int? =
    (error as? android.system.ErrnoException)?.errno
}

internal object UnexpectedNativeError {
  private val reporter = NativeFailureReporter { report ->
    Sentry.withScope { scope ->
      scope.level = SentryLevel.ERROR
      scope.fingerprint = listOf("native", report.category, report.operation)
      scope.setTag("native.operation", report.operation)
      scope.setTag("native.category", report.category)
      scope.setExtra("native.error_type", report.errorType)
      report.errorCode?.let { scope.setExtra("native.error_code", it.toString()) }
      Sentry.captureMessage("Native operation failed")
    }
  }

  fun report(operation: String, category: String, error: Throwable) {
    reporter.report(operation, category, error)
  }
}
