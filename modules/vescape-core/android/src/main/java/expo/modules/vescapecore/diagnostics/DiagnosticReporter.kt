package expo.modules.vescapecore.diagnostics
import android.content.Context
import expo.modules.vescapecore.telemetry.TelemetryRepository
import java.util.UUID

/**
 * Diagnostic captures surfaced to JS through `reportUiError` / `reportDiagnosticTest` /
 * `getDiagnosticStatus`. Events are kept as Local Diagnostic Events (ADR 0007) in the telemetry
 * store; there is no remote analytics transport — crash and error monitoring is Sentry's job.
 *
 * @parity /modules/vescape-core/ios/diagnostics/DiagnosticReporter.swift
 */
fun interface DiagnosticSink {
    fun capture(eventName: String, properties: Map<String, Any?>)
}

class DiagnosticReporter private constructor(
    private val sink: DiagnosticSink,
    private val commonProperties: Map<String, Any?>,
) {
    private var captureCount = 0
    private var lastEventName: String? = null
    private var lastCaptureAt: Long? = null

    fun capture(eventName: String, properties: Map<String, Any?> = emptyMap()) {
        captureCount += 1
        lastEventName = eventName
        lastCaptureAt = System.currentTimeMillis()
        sink.capture(eventName, sanitize(commonProperties + properties))
    }

    fun status(): Map<String, Any?> = mapOf(
        "captureCount" to captureCount,
        "lastEventName" to lastEventName,
        "lastCaptureAt" to lastCaptureAt,
    )

    companion object {
        @Volatile private var shared: DiagnosticReporter? = null

        fun initialize(context: Context, sink: DiagnosticSink? = null): DiagnosticReporter {
            sink?.let {
                return DiagnosticReporter(
                    sink = it,
                    commonProperties = commonProperties(context),
                ).also { reporter ->
                    shared = reporter
                }
            }

            shared?.let { return it }
            synchronized(this) {
                shared?.let { return it }
                val appContext = context.applicationContext
                val reporter = DiagnosticReporter(
                    sink = { eventName, properties ->
                        TelemetryRepository.get(appContext).recordDiagnosticEvent(eventName, properties)
                    },
                    commonProperties = commonProperties(appContext),
                )
                shared = reporter
                return reporter
            }
        }

        fun get(context: Context): DiagnosticReporter = shared ?: initialize(context)

        fun resetForTests() {
            shared = null
        }

        fun telemetryPayloadProperties(payload: ByteArray): Map<String, Any?> {
            return DiagnosticPayloadProperties.telemetry(payload)
        }

        fun configBlobProperties(config: ByteArray?): Map<String, Any?> {
            return DiagnosticPayloadProperties.configBlob(config)
        }

        private fun commonProperties(context: Context): Map<String, Any?> {
            val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
            return mapOf(
                "platform" to "android",
                "app_version" to packageInfo.versionName,
            )
        }

        private fun sanitize(properties: Map<String, Any?>): Map<String, Any?> =
            properties.filterKeys { key ->
                !key.contains("latitude", ignoreCase = true) &&
                    !key.contains("longitude", ignoreCase = true)
            }.mapValues { (_, value) ->
                when (value) {
                    is String, is Number, is Boolean, null -> value
                    else -> value.toString()
                }
            }
    }
}

internal fun newOperationId(): String = UUID.randomUUID().toString()
